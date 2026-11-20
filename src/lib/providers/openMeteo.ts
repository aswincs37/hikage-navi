import type { Endpoint } from "@/lib/config/env";
import type { WeatherSample, WeatherValues } from "@/lib/domain/types";
import { fetchJson, ProviderError, TtlCache } from "@/lib/http/fetch";
import { toTokyoIso, tokyoDateString } from "@/lib/time/tokyo";
import type { WeatherProvider, WeatherQueryPoint } from "./types";

/**
 * Open-Meteo 予報API アダプター（毎時値）。
 * 日本付近では気象庁のモデル（MSM/GSM）等を組み合わせた "best_match" を使う。
 * これは数値予報モデルの出力をOpen-Meteoが加工した値であり、気象庁の公式な予報発表ではない。
 * UVインデックスもモデル計算値であり、気象庁の「紫外線情報」とは異なる。
 */

const HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "wind_speed_10m",
  "cloud_cover",
  "precipitation_probability",
  "uv_index",
] as const;

type HourlyKey = (typeof HOURLY)[number];

export interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  hourly?: { time: number[] } & Partial<Record<HourlyKey, (number | null)[]>>;
  hourly_units?: Partial<Record<HourlyKey, string>>;
}

/** 毎時値から何分以内なら対応付けるか */
const MAX_ALIGN_MIN = 45;
/** 近い地点はまとめて1地点として問い合わせる（度）。モデルの格子間隔（数km）と同程度 */
const GRID_DEG = 0.05;

const cache = new TtlCache<OpenMeteoLocation[]>(30 * 60 * 1000, 300);

export class OpenMeteoProvider implements WeatherProvider {
  readonly id = "open-meteo";
  constructor(
    private readonly endpoint: Endpoint,
    private readonly http: { timeoutMs: number; userAgent: string },
    private readonly apiKey?: string,
  ) {}

  async forecast(points: WeatherQueryPoint[]): Promise<(WeatherSample | null)[]> {
    if (points.length === 0) return [];
    const keyOf = (p: WeatherQueryPoint) => `${snap(p.lat)},${snap(p.lon)}`;
    const locations = [...new Set(points.map(keyOf))];
    const times = points.map((p) => p.time.getTime());
    const startDate = tokyoDateString(new Date(Math.min(...times)));
    const endDate = tokyoDateString(new Date(Math.max(...times)));

    const params = new URLSearchParams({
      latitude: locations.map((l) => l.split(",")[0]).join(","),
      longitude: locations.map((l) => l.split(",")[1]).join(","),
      hourly: HOURLY.join(","),
      wind_speed_unit: "ms",
      temperature_unit: "celsius",
      timezone: "Asia/Tokyo",
      timeformat: "unixtime",
      start_date: startDate,
      end_date: endDate,
    });
    if (this.apiKey) params.set("apikey", this.apiKey);
    const url = `${this.endpoint.url}?${params}`;

    const data = await cache.getOrLoad(url, async () => {
      const raw = await fetchJson<OpenMeteoLocation | OpenMeteoLocation[] | { error: true; reason: string }>(url, {
        provider: this.id,
        ...this.http,
      });
      if (!Array.isArray(raw) && "error" in raw) throw new ProviderError("http", this.id, 400);
      return Array.isArray(raw) ? raw : [raw as OpenMeteoLocation];
    });

    const retrievedAt = new Date().toISOString();
    return points.map((p) => {
      const loc = data[locations.indexOf(keyOf(p))];
      return loc ? extractSample(loc, p.time, this.id, retrievedAt) : null;
    });
  }
}

function snap(v: number): string {
  return (Math.round(v / GRID_DEG) * GRID_DEG).toFixed(2);
}

/** 指定時刻に最も近い毎時値を取り出す。45分以上離れていれば null */
export function extractSample(loc: OpenMeteoLocation, time: Date, providerId: string, retrievedAt: string): WeatherSample | null {
  const h = loc.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length === 0) return null;
  const target = time.getTime() / 1000;
  let best = -1;
  let bestDiff = Infinity;
  h.time.forEach((t, i) => {
    const d = Math.abs(t - target);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  if (best < 0 || bestDiff > MAX_ALIGN_MIN * 60) return null;

  const pick = (k: HourlyKey) => {
    const v = h[k]?.[best];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  // 単位が想定と異なる場合は換算（風速を m/s に揃える）
  let wind = pick("wind_speed_10m");
  const windUnit = loc.hourly_units?.wind_speed_10m;
  if (wind !== undefined && windUnit === "km/h") wind = Math.round((wind / 3.6) * 100) / 100;
  let temp = pick("temperature_2m");
  if (temp !== undefined && loc.hourly_units?.temperature_2m === "°F") temp = Math.round(((temp - 32) * 5) / 9 * 10) / 10;

  const values: WeatherValues = {
    temperatureC: temp,
    relativeHumidityPct: pick("relative_humidity_2m"),
    windSpeedMs: wind,
    cloudCoverPct: pick("cloud_cover"),
    precipitationProbabilityPct: pick("precipitation_probability"),
    uvIndex: pick("uv_index"),
  };
  if (Object.values(values).every((v) => v === undefined)) return null;
  return {
    lat: loc.latitude,
    lon: loc.longitude,
    validTime: toTokyoIso(new Date(h.time[best]! * 1000)),
    values,
    source: {
      provider: providerId,
      kind: "provider_forecast",
      retrievedAt,
      attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
      note: "model:best_match",
    },
  };
}
