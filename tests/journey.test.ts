import { describe, expect, it } from "vitest";
import { available, type RouteAlternative, type WbgtSample, type WeatherSample } from "@/lib/domain/types";
import { compareDepartures, searchJourney } from "@/lib/journey/search";
import type { Providers } from "@/lib/providers/registry";
import { ProviderError } from "@/lib/http/fetch";
import { toTokyoIso } from "@/lib/time/tokyo";
import { validateDepartureTimes, validateJourneyRequest, type JourneyRequest } from "@/lib/validation/schemas";
import { leg, line, route, t } from "./helpers";

const NOW = t("2026-07-01T08:00");
const ORIGIN = { lat: 35.68, lon: 139.7 };
const DEST = { lat: 35.68, lon: 139.713 };

/** 電車の候補（駅までの徒歩区間＋乗車区間）。徒歩区間の日差しを評価できる */
function trainRoutes(departure: Date): RouteAlternative[] {
  const walk0 = line([139.7, 35.68], "east", 1200);
  const walk1 = line([139.7, 35.68], "north", 1500);
  return [
    route("train-0", [leg("walk", walk0, departure, 900), leg("rail", line(walk0[walk0.length - 1]!, "east", 8000), new Date(departure.getTime() + 900_000), 600)]),
    route("train-1", [leg("walk", walk1, departure, 1200), leg("rail", line(walk1[walk1.length - 1]!, "east", 8000), new Date(departure.getTime() + 1_200_000), 600)]),
  ];
}

/** 道路（車）の候補。経路は時刻に依存しない */
function carRoutes(departure: Date): RouteAlternative[] {
  return [route("car-0", [leg("car", line([139.7, 35.68], "east", 8000), departure, 900)])];
}

function weatherAt(temp: number, uv: number) {
  return {
    id: "fake-weather",
    forecast: async (pts: { lat: number; lon: number; time: Date }[]) =>
      pts.map((p): WeatherSample => ({
        lat: p.lat,
        lon: p.lon,
        validTime: toTokyoIso(p.time),
        values: { temperatureC: temp, uvIndex: uv, cloudCoverPct: 10 },
        source: { provider: "fake-weather", kind: "provider_forecast" },
      })),
  };
}

function providers(over: Partial<Providers> = {}): Providers {
  return {
    geocoder: null,
    suggester: null,
    street: { car: { id: "fake-car", route: async (_o, _d, dep) => carRoutes(dep) } },
    transit: { id: "fake-transit", plan: async (_o, _d, dep) => trainRoutes(dep) },
    weather: weatherAt(29, 7),
    wbgt: null,
    shade: null,
    shadeMaxRouteKm: 5,
    weatherMaxLeadDays: 7,
    configNotices: [],
    ...over,
  };
}

const req = (o: Partial<JourneyRequest> = {}): JourneyRequest => ({
  origin: ORIGIN,
  destination: DEST,
  departure: t("2026-07-01T12:00"),
  mode: "train",
  preferences: ["minimise_time"],
  ...o,
});

describe("searchJourney", () => {
  it("経路を評価・順位付けし、気象と注意喚起を付ける", async () => {
    const r = await searchJourney(req(), providers(), NOW);
    expect(r.status).toBe("ok");
    expect(r.routes.map((x) => x.route.id)).toEqual(["train-0", "train-1"]);
    const top = r.routes[0]!;
    expect(top.weather.temperatureRangeC).toEqual([29, 29]);
    expect(top.heatWarnings.map((w) => w.code).sort()).toEqual(["uv_high", "wbgt_unavailable"]);
    expect(top.weather.wbgt).toMatchObject({ status: "unavailable", reason: "not_configured" });
    // 日陰データ未設定 → 告知し、日陰は不明として扱う
    expect(r.notices.some((n) => n.messageCode === "shade_not_configured")).toBe(true);
    expect(top.exposure.unknownShadeMin).toBe(top.exposure.sunUpOutdoorMin);
  });

  it("気象プロバイダーが失敗しても経路と太陽の計算は返す", async () => {
    const r = await searchJourney(
      req(),
      providers({ weather: { id: "w", forecast: async () => { throw new ProviderError("timeout", "w"); } } }),
      NOW,
    );
    expect(r.status).toBe("ok");
    expect(r.routes[0]!.weather.samples).toMatchObject({ status: "unavailable", reason: "timeout" });
    expect(r.routes[0]!.exposure.sunUpOutdoorMin).toBe(15);
    expect(r.notices.map((n) => n.messageCode)).toContain("weather_timeout");
  });

  it("予報期間外の日時は気象を問い合わせない", async () => {
    let called = false;
    const r = await searchJourney(
      req({ departure: t("2026-07-20T12:00") }),
      providers({ weather: { id: "w", forecast: async () => { called = true; return []; } } }),
      NOW,
    );
    expect(called).toBe(false);
    expect(r.routes[0]!.weather.samples).toMatchObject({ status: "unavailable", reason: "out_of_range" });
    expect(r.notices.map((n) => n.messageCode)).toContain("weather_too_far");
  });

  it("鉄道・バスは時刻表プロバイダー未設定なら『未対応』（時刻表を作らない）", async () => {
    const r = await searchJourney(req(), providers({ transit: null }), NOW);
    expect(r.status).toBe("unsupported");
    expect(r.routes).toEqual([]);
    expect(r.notices.map((n) => n.messageCode)).toContain("transit_not_configured");
  });

  it("経路が見つからない・プロバイダーエラーを区別する", async () => {
    const empty = await searchJourney(req(), providers({ transit: { id: "w", plan: async () => [] } }), NOW);
    expect(empty.status).toBe("no_routes");
    const failing = await searchJourney(
      req(),
      providers({ transit: { id: "w", plan: async () => { throw new ProviderError("network", "w"); } } }),
      NOW,
    );
    expect(failing.status).toBe("provider_error");
    expect(failing.notices.map((n) => n.messageCode)).toContain("transit_error");
  });

  it("未設定の移動手段は unsupported", async () => {
    const r = await searchJourney(req({ mode: "car" }), providers({ street: { car: null } }), NOW);
    expect(r.status).toBe("unsupported");
  });

  it("公式WBGTが危険域なら、順位とは独立に警告する", async () => {
    const wbgt = {
      id: "fake-wbgt",
      forecast: async (pts: { time: Date }[]) =>
        available(
          pts.map((p): WbgtSample => ({ stationId: "44132", stationName: "東京", distanceKm: 2, validTime: toTokyoIso(p.time), wbgt: 31.4, level: "danger", source: { provider: "fake-wbgt", kind: "official_forecast" } })),
          { provider: "fake-wbgt", kind: "official_forecast" },
        ),
    };
    const r = await searchJourney(req(), providers({ wbgt }), NOW);
    for (const route of r.routes) expect(route.heatWarnings[0]).toMatchObject({ level: "danger", code: "wbgt_danger", value: 31.4 });
  });
});

describe("compareDepartures", () => {
  it("道路の経路は1回だけ取得し、出発時刻をずらして再計算する", async () => {
    let calls = 0;
    const p = providers({ street: { car: { id: "c", route: async (_o, _d, dep) => { calls++; return carRoutes(dep); } } } });
    const r = await compareDepartures(req({ mode: "car" }), ["06:00", "12:00", "20:00"], p, NOW);
    expect(calls).toBe(1);
    expect(r.durationsAreTimeIndependent).toBe(true);
    expect(r.options.map((o) => o.best!.route.startTime)).toEqual([
      "2026-07-01T06:00:00+09:00",
      "2026-07-01T12:00:00+09:00",
      "2026-07-01T20:00:00+09:00",
    ]);
    expect(r.options[2]!.best!.vehicleSides[0]!.nightMin).toBe(15);
    expect(r.options[1]!.best!.vehicleSides[0]!.nightMin).toBe(0);
  });

  it("鉄道は時刻ごとにプロバイダーへ問い合わせ、未設定なら全時刻 unsupported", async () => {
    const r = await compareDepartures(req(), ["09:00", "10:00"], providers({ transit: null }), NOW);
    expect(r.options.every((o) => o.status === "unsupported")).toBe(true);
  });
});

describe("入力検証", () => {
  const body = { origin: ORIGIN, destination: DEST, departure: "2026-07-01T12:00", mode: "train", preferences: [] };

  it("正しい入力を受け付ける", () => {
    const v = validateJourneyRequest(body, NOW);
    expect(v.ok).toBe(true);
  });

  it.each([
    [{ ...body, origin: { lat: 95, lon: 139 } }, "origin.lat"],
    [{ ...body, mode: "plane" }, "mode"],
    [{ ...body, mode: "walk" }, "mode"],
    [{ ...body, mode: "cycle" }, "mode"],
    [{ ...body, departure: "2026-02-30T10:00" }, "departure"],
    [{ ...body, departure: "2026-06-01T10:00" }, "departure"],
    [{ ...body, departure: "2026-09-01T10:00" }, "departure"],
    [{ ...body, destination: { lat: 37.77, lon: -122.42 } }, "destination"],
    [{ ...body, destination: ORIGIN }, "destination"],
    [{ ...body, destination: { lat: 26.21, lon: 127.68 } }, "destination"],
    [{ ...body, preferences: ["fastest"] }, "preferences.0"],
  ])("不正な入力を拒否する (%#)", (input, field) => {
    const v = validateJourneyRequest(input, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.map((i) => i.field)).toContain(field);
  });

  it("比較する出発時刻", () => {
    expect(validateDepartureTimes(undefined)).toMatchObject({ ok: true });
    expect(validateDepartureTimes(["13:00", "09:00", "09:00"])).toEqual({ ok: true, value: ["09:00", "13:00"] });
    expect(validateDepartureTimes(["25:00"]).ok).toBe(false);
    expect(validateDepartureTimes([]).ok).toBe(false);
  });
});
