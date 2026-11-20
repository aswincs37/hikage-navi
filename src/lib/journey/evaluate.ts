import {
  available,
  unavailable,
  type EvaluatedRoute,
  type LonLat,
  type Maybe,
  type ProviderNotice,
  type RouteAlternative,
  type RouteWeatherSummary,
  type SegmentEstimate,
  type ShadeSample,
  type SourceRef,
  type WbgtSample,
  type WeatherSample,
} from "@/lib/domain/types";
import { haversineM, lineLengthM } from "@/lib/geo/geometry";
import { heatWarnings } from "@/lib/heat/warnings";
import { ProviderError } from "@/lib/http/fetch";
import type { Providers } from "@/lib/providers/registry";
import type { WeatherQueryPoint } from "@/lib/providers/types";
import { SHADE_CORRIDOR_M, ShadeModel } from "@/lib/shade/engine";
import { evaluateSegments, summariseExposure, vehicleSideExposure } from "@/lib/solar/exposure";
import { addSeconds, toTokyoIso } from "@/lib/time/tokyo";

export type EvalProviders = Pick<Providers, "weather" | "wbgt" | "shade" | "shadeMaxRouteKm" | "weatherMaxLeadDays">;

export interface ShadeContext {
  model: ShadeModel | null;
  source?: SourceRef;
  reason?: ShadeSample["reason"];
}

/** 出発時刻をずらした経路を作る（OSRM の経路は時刻に依存しないため、出発時刻の比較に使う） */
export function shiftRoute(route: RouteAlternative, sec: number): RouteAlternative {
  const s = (iso: string) => toTokyoIso(addSeconds(new Date(iso), sec));
  return {
    ...route,
    startTime: s(route.startTime),
    endTime: s(route.endTime),
    legs: route.legs.map((l) => ({ ...l, startTime: s(l.startTime), endTime: s(l.endTime) })),
  };
}

function errorNotice(capability: ProviderNotice["capability"], provider: string, e: unknown): ProviderNotice {
  const kind = e instanceof ProviderError ? e.kind : "unknown";
  return { provider, capability, status: "unavailable", messageCode: `${capability}_${kind === "timeout" ? "timeout" : "error"}` };
}

/** 屋外区間の建物データを取得し、日陰モデルを作る */
export async function buildShadeContext(routes: RouteAlternative[], providers: EvalProviders, notices: ProviderNotice[]): Promise<ShadeContext> {
  const outdoorLines: LonLat[][] = routes.flatMap((r) => r.legs.filter((l) => l.outdoor).map((l) => l.geometry));
  if (outdoorLines.length === 0) return { model: null };
  if (!providers.shade) {
    notices.push({ provider: "shade", capability: "shade", status: "not_configured", messageCode: "shade_not_configured" });
    return { model: null, reason: "shade_data_unavailable" };
  }
  const longest = Math.max(...outdoorLines.map(lineLengthM));
  if (longest > providers.shadeMaxRouteKm * 1000) {
    notices.push({ provider: providers.shade.id, capability: "shade", status: "partial", messageCode: "shade_route_too_long" });
    return { model: null, reason: "route_too_long" };
  }
  try {
    const { buildings, source } = await providers.shade.buildingsNear(outdoorLines, SHADE_CORRIDOR_M);
    return { model: new ShadeModel(buildings), source };
  } catch (e) {
    notices.push(errorNotice("shade", providers.shade.id, e));
    return { model: null, reason: "shade_data_unavailable" };
  }
}

/** 天気を問い合わせる代表点（所要時間に応じて約10分ごと、最大10点） */
export function weatherQueryPoints(segments: SegmentEstimate[], durationSec: number): WeatherQueryPoint[] {
  if (segments.length === 0) return [];
  const interval = Math.max(600, durationSec / 10);
  const start = new Date(segments[0]!.startTime).getTime();
  const out: WeatherQueryPoint[] = [];
  let next = 0;
  for (const s of segments) {
    const t = new Date(s.startTime).getTime();
    if ((t - start) / 1000 >= next) {
      out.push({ lat: s.lat, lon: s.lon, time: addSeconds(new Date(s.startTime), s.durationSec / 2) });
      next += interval;
    }
  }
  const last = segments[segments.length - 1]!;
  const lastPoint = out[out.length - 1]!;
  if (haversineM([lastPoint.lon, lastPoint.lat], [last.lon, last.lat]) > 500) {
    out.push({ lat: last.lat, lon: last.lon, time: addSeconds(new Date(last.startTime), last.durationSec) });
  }
  return out;
}

export function summariseWeather(samples: Maybe<WeatherSample[]>, wbgt: Maybe<WbgtSample[]>): RouteWeatherSummary {
  const summary: RouteWeatherSummary = { samples, wbgt };
  if (samples.status === "available" && samples.value.length > 0) {
    const v = samples.value.map((s) => s.values);
    const temps = v.map((x) => x.temperatureC).filter((x): x is number => x !== undefined);
    if (temps.length) summary.temperatureRangeC = [Math.min(...temps), Math.max(...temps)];
    const uv = v.map((x) => x.uvIndex).filter((x): x is number => x !== undefined);
    if (uv.length) summary.maxUvIndex = Math.max(...uv);
    const pp = v.map((x) => x.precipitationProbabilityPct).filter((x): x is number => x !== undefined);
    if (pp.length) summary.maxPrecipitationProbabilityPct = Math.max(...pp);
    const cc = v.map((x) => x.cloudCoverPct).filter((x): x is number => x !== undefined);
    if (cc.length) summary.meanCloudCoverPct = Math.round(cc.reduce((a, b) => a + b, 0) / cc.length);
  }
  if (wbgt.status === "available" && wbgt.value.length > 0) {
    summary.maxWbgt = wbgt.value.reduce((a, b) => (b.wbgt > a.wbgt ? b : a));
  }
  return summary;
}

/**
 * 経路の評価（区間ごとの太陽位置・日陰、気象、暑さ指数、注意喚起）。
 * 気象・暑さ指数の問い合わせは全経路分をまとめて1回ずつ行い、建物データの取得と並行して進める。
 */
export async function evaluateRoutes(
  routes: RouteAlternative[],
  shadeInput: ShadeContext | Promise<ShadeContext>,
  providers: EvalProviders,
  notices: ProviderNotice[],
  now: Date = new Date(),
): Promise<EvaluatedRoute[]> {
  // 区間の分割と通過時刻は日陰の有無に関係しないため、先に気象の問い合わせ地点を決める
  const pointsPerRoute = routes.map((r) => weatherQueryPoints(evaluateSegments(r, { shadeModel: null }), r.durationSec));
  const allPoints = pointsPerRoute.flat();

  const [weatherAll, wbgtAll, shade] = await Promise.all([
    fetchWeather(allPoints, providers, notices, now),
    fetchWbgt(allPoints, providers, notices, now),
    shadeInput,
  ]);

  let offset = 0;
  return routes.map((route, i) => {
    const segments = evaluateSegments(route, { shadeModel: shade.model, shadeUnavailableReason: shade.reason });
    const n = pointsPerRoute[i]!.length;
    const slice = <T>(m: Maybe<(T | null)[]>): Maybe<T[]> => {
      if (m.status === "unavailable") return m;
      const vals = m.value.slice(offset, offset + n).filter((v): v is T => v !== null);
      return vals.length > 0 ? available(vals, m.source) : unavailable("out_of_range", "no_matching_sample");
    };
    const weather = summariseWeather(slice(weatherAll), slice(wbgtAll));
    offset += n;
    const exposure = summariseExposure(segments, {
      shadeSource: shade.source,
      shadeMissingReason: shade.model ? undefined : shade.reason,
      hasWeather: weather.samples.status === "available",
    });
    return {
      route,
      segments,
      exposure,
      vehicleSides: vehicleSideExposure(segments, route),
      weather,
      heatWarnings: heatWarnings(weather),
    };
  });
}

/** 予報の対象期間外（遠すぎる未来・過去）か */
function forecastWindow(points: WeatherQueryPoint[], providers: EvalProviders, now: Date) {
  const earliest = Math.min(...points.map((p) => p.time.getTime()));
  const latest = Math.max(...points.map((p) => p.time.getTime()));
  return {
    tooFar: latest - now.getTime() > providers.weatherMaxLeadDays * 86_400_000,
    tooPast: now.getTime() - earliest > 86_400_000,
  };
}

async function fetchWeather(
  points: WeatherQueryPoint[],
  providers: EvalProviders,
  notices: ProviderNotice[],
  now: Date,
): Promise<Maybe<(WeatherSample | null)[]>> {
  if (points.length === 0) return unavailable("insufficient_data");
  if (!providers.weather) {
    notices.push({ provider: "weather", capability: "weather", status: "not_configured", messageCode: "weather_not_configured" });
    return unavailable("not_configured");
  }
  const { tooFar, tooPast } = forecastWindow(points, providers, now);
  if (tooFar || tooPast) {
    notices.push({ provider: providers.weather.id, capability: "weather", status: "unavailable", messageCode: tooFar ? "weather_too_far" : "weather_past" });
    return unavailable("out_of_range", tooFar ? "beyond_forecast_horizon" : "past");
  }
  try {
    const res = await providers.weather.forecast(points);
    const firstSource = res.find((s) => s)?.source;
    return firstSource ? available(res, firstSource) : unavailable("out_of_range", "no_matching_hour");
  } catch (e) {
    notices.push(errorNotice("weather", providers.weather.id, e));
    return unavailable(e instanceof ProviderError && e.kind === "timeout" ? "timeout" : "provider_error");
  }
}

async function fetchWbgt(
  points: WeatherQueryPoint[],
  providers: EvalProviders,
  notices: ProviderNotice[],
  now: Date,
): Promise<Maybe<(WbgtSample | null)[]>> {
  if (points.length === 0) return unavailable("insufficient_data");
  if (!providers.wbgt) return unavailable("not_configured");
  const { tooFar, tooPast } = forecastWindow(points, providers, now);
  if (tooFar || tooPast) return unavailable("out_of_range");
  try {
    const res = await providers.wbgt.forecast(points);
    if (res.status === "unavailable" && res.reason === "out_of_season") {
      notices.push({ provider: providers.wbgt.id, capability: "wbgt", status: "unavailable", messageCode: "wbgt_out_of_season", detail: res.detail });
    }
    return res;
  } catch (e) {
    notices.push(errorNotice("wbgt", providers.wbgt.id, e));
    return unavailable("provider_error");
  }
}
