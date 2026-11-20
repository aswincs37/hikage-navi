import { afterEach, describe, expect, it, vi } from "vitest";
import { normaliseOsrm, OsrmRoutingProvider } from "@/lib/providers/osrm";
import { normaliseOtp, type OtpPlanResponse } from "@/lib/providers/otp";
import { extractSample, type OpenMeteoLocation } from "@/lib/providers/openMeteo";
import { lookupWbgt, parseAmedasTable, parseWbgtForecastCsv, wbgtLevel } from "@/lib/providers/moeWbgt";
import { bigramSimilarity, CompositeGeocoder, PhotonGeocoder, shortenOsmName } from "@/lib/providers/geocoding";
import { buildCorridorQuery } from "@/lib/providers/overpass";
import { fetchJson, ProviderError } from "@/lib/http/fetch";
import { t } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("OSRM", () => {
  const fixture = {
    code: "Ok",
    routes: [
      {
        distance: 300,
        duration: 240,
        geometry: { type: "LineString" as const, coordinates: [[139.7, 35.68], [139.701, 35.68], [139.702, 35.681]] as [number, number][] },
        legs: [{ annotation: { duration: [100, 140], distance: [90, 210] } }],
      },
    ],
  };

  it("区間ごとの所要時間（annotation）から頂点の通過時刻を作る", () => {
    const [r] = normaliseOsrm(fixture, "car", t("2026-07-01T09:00"), "osrm-car");
    expect(r!.legs[0]!.vertexOffsetsSec).toEqual([0, 100, 240]);
    expect(r!.endTime).toBe("2026-07-01T09:04:00+09:00");
    expect(r!.source.kind).toBe("provider_route");
  });

  it("自動車は屋外区間ではなく、徒歩時間 0", () => {
    const [r] = normaliseOsrm(fixture, "car", t("2026-07-01T09:00"), "osrm-car");
    expect(r!.legs[0]!.outdoor).toBe(false);
    expect(r!.walkingSec).toBe(0);
  });

  it("annotation が無い場合は距離比例で配分する", () => {
    const noAnn = { ...fixture, routes: [{ ...fixture.routes[0]!, legs: [{}] }] };
    const [r] = normaliseOsrm(noAnn, "car", t("2026-07-01T09:00"), "osrm-car");
    expect(r!.legs[0]!.vertexOffsetsSec[2]).toBeCloseTo(240, 6);
  });

  it("経路なし・形状なしは空、異常な応答はエラー", () => {
    expect(normaliseOsrm({ code: "NoRoute" }, "car", new Date(), "x")).toEqual([]);
    expect(normaliseOsrm({ code: "Ok", routes: [{ ...fixture.routes[0]!, geometry: { type: "LineString", coordinates: [] } }] }, "car", new Date(), "x")).toEqual([]);
    expect(() => normaliseOsrm({ code: "InvalidQuery" }, "car", new Date(), "x")).toThrow(ProviderError);
  });

  it("HTTP 400（経路なし）は空の結果として扱う", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"NoRoute"}', { status: 400 })));
    const p = new OsrmRoutingProvider("car", { url: "https://example.test", publicDemo: false }, { timeoutMs: 1000, userAgent: "test" });
    await expect(p.route({ lat: 35, lon: 139 }, { lat: 35.1, lon: 139.1 }, new Date())).resolves.toEqual([]);
  });
});

describe("HTTP 共通処理", () => {
  it("タイムアウトを ProviderError(timeout) にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))))),
    );
    await expect(fetchJson("https://example.test", { provider: "p", timeoutMs: 20, userAgent: "t" })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("HTTP エラー・不正な JSON を分類する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));
    await expect(fetchJson("https://example.test", { provider: "p", timeoutMs: 1000, userAgent: "t" })).rejects.toMatchObject({ kind: "http", status: 503 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(fetchJson("https://example.test", { provider: "p", timeoutMs: 1000, userAgent: "t" })).rejects.toMatchObject({ kind: "parse" });
  });
});

describe("OpenTripPlanner", () => {
  const ms = (s: string) => t(s).getTime();
  const fixture: OtpPlanResponse = {
    data: {
      plan: {
        itineraries: [
          {
            startTime: ms("2026-07-01T09:00"),
            endTime: ms("2026-07-01T09:40"),
            duration: 2400,
            walkTime: 600,
            waitingTime: 180,
            walkDistance: 700,
            legs: [
              { mode: "WALK", startTime: ms("2026-07-01T09:00"), endTime: ms("2026-07-01T09:05"), duration: 300, distance: 350, transitLeg: false, from: { name: "出発地", lat: 35.68, lon: 139.7 }, to: { name: "A駅", lat: 35.682, lon: 139.702 }, legGeometry: { points: "_p~iF~ps|U_ulLnnqC" } },
              { mode: "RAIL", startTime: ms("2026-07-01T09:08"), endTime: ms("2026-07-01T09:35"), duration: 1620, distance: 15000, transitLeg: true, from: { name: "A駅", lat: 35.682, lon: 139.702 }, to: { name: "B駅", lat: 35.8, lon: 139.75 }, route: { shortName: "テスト線", agency: { name: "テスト鉄道" } }, legGeometry: null },
              { mode: "WALK", startTime: ms("2026-07-01T09:35"), endTime: ms("2026-07-01T09:40"), duration: 300, distance: 350, transitLeg: false, from: { name: "B駅", lat: 35.8, lon: 139.75 }, to: { name: "目的地", lat: 35.801, lon: 139.752 } },
            ],
          },
          {
            startTime: ms("2026-07-01T09:00"),
            endTime: ms("2026-07-01T10:30"),
            duration: 5400,
            walkTime: 5400,
            waitingTime: 0,
            walkDistance: 6000,
            legs: [{ mode: "WALK", startTime: ms("2026-07-01T09:00"), endTime: ms("2026-07-01T10:30"), duration: 5400, distance: 6000, transitLeg: false, from: { lat: 35.68, lon: 139.7 }, to: { lat: 35.8, lon: 139.75 } }],
          },
        ],
      },
    },
  };

  it("時刻表由来の経路として正規化し、徒歩のみの候補は除外する", () => {
    const routes = normaliseOtp(fixture, "train", "opentripplanner");
    expect(routes).toHaveLength(1);
    const r = routes[0]!;
    expect(r.source.kind).toBe("provider_timetable");
    expect(r.transfers).toBe(0);
    expect(r.waitingSec).toBe(180);
    expect(r.legs.map((l) => [l.mode, l.outdoor])).toEqual([["walk", true], ["rail", false], ["walk", true]]);
    expect(r.legs[1]!.routeName).toBe("テスト線");
    expect(r.legs[1]!.startTime).toBe("2026-07-01T09:08:00+09:00");
    // 形状が無い区間は両端を結ぶ（区間の向きの推定精度は下がる）
    expect(r.legs[1]!.geometry).toHaveLength(2);
  });

  it("GraphQL エラーは ProviderError", () => {
    expect(() => normaliseOtp({ errors: [{ message: "bad" }] }, "train", "otp")).toThrow(ProviderError);
    expect(normaliseOtp({ data: { plan: { itineraries: [] } } }, "bus", "otp")).toEqual([]);
  });
});

describe("Open-Meteo", () => {
  const base = t("2026-07-01T09:00").getTime() / 1000;
  const loc: OpenMeteoLocation = {
    latitude: 35.7,
    longitude: 139.75,
    hourly: {
      time: [base, base + 3600, base + 7200],
      temperature_2m: [30.1, 31.5, null],
      relative_humidity_2m: [70, 65, 60],
      wind_speed_10m: [3, 4, 5],
      cloud_cover: [20, 40, 60],
      precipitation_probability: [10, null, 30],
      uv_index: [6.5, 7.8, 8.2],
    },
    hourly_units: { temperature_2m: "°C", wind_speed_10m: "m/s" },
  };

  it("最も近い毎時値に対応付け、時刻と出典を付ける", () => {
    const s = extractSample(loc, t("2026-07-01T10:20"), "open-meteo", "now")!;
    expect(s.validTime).toBe("2026-07-01T10:00:00+09:00");
    expect(s.values.temperatureC).toBe(31.5);
    expect(s.values.precipitationProbabilityPct).toBeUndefined(); // 欠損は 0 にしない
    expect(s.source.kind).toBe("provider_forecast");
  });

  it("45分以上離れた時刻には対応付けない", () => {
    expect(extractSample(loc, t("2026-07-01T12:00"), "open-meteo", "now")).toBeNull();
    expect(extractSample({ latitude: 0, longitude: 0 }, t("2026-07-01T09:00"), "x", "now")).toBeNull();
  });

  it("km/h・°F を m/s・°C に換算する", () => {
    const s = extractSample(
      { ...loc, hourly_units: { wind_speed_10m: "km/h", temperature_2m: "°F" }, hourly: { ...loc.hourly!, wind_speed_10m: [36, 0, 0], temperature_2m: [86, 0, 0] } },
      t("2026-07-01T09:00"),
      "x",
      "now",
    )!;
    expect(s.values.windSpeedMs).toBe(10);
    expect(s.values.temperatureC).toBe(30);
  });
});

describe("環境省 WBGT 予測値", () => {
  const csv = [
    ",,2026070103,2026070106,2026070109,2026070112,2026070115,2026070118,2026070121,2026070124",
    "44132,2026/07/01 05:25, 250, 248, 290, 315, 305, 280, 265, 255",
    "11001,2026/07/01 05:25, 150, 150, , 180, 190, 170, 160, 150",
  ].join("\r\n");
  const stations = parseAmedasTable({
    "44132": { lat: [35, 41.5], lon: [139, 45.0], kjName: "東京" },
    "11001": { lat: [45, 31.2], lon: [141, 56.1], kjName: "宗谷岬" },
    "99999": { lat: [35, 0], lon: [135, 0], kjName: "データなし" },
  });

  it("CSV を解釈する（値は10倍、24時は翌日0時、空欄は欠損）", () => {
    const table = parseWbgtForecastCsv(csv);
    expect(table.times[7]!.toISOString()).toBe(t("2026-07-02T00:00").toISOString());
    expect(table.values.get("44132")![3]).toBe(31.5);
    expect(table.values.get("11001")![2]).toBeNull();
    expect(table.issuedAt!.toISOString()).toBe(t("2026-07-01T05:25").toISOString());
  });

  it("近くの地点の、最も近い予測時刻の値を公式予報として返す", () => {
    const table = parseWbgtForecastCsv(csv);
    const r = lookupWbgt(table, stations, [{ lat: 35.68, lon: 139.77, time: t("2026-07-01T12:30") }], t("2026-07-01T08:00"), 25);
    expect(r.status).toBe("available");
    if (r.status !== "available") return;
    expect(r.value[0]).toMatchObject({ stationName: "東京", wbgt: 31.5, level: "danger" });
    expect(r.source.kind).toBe("official_forecast");
  });

  it("発表から36時間を超えたデータは提供期間外として使わない", () => {
    const table = parseWbgtForecastCsv(csv);
    const r = lookupWbgt(table, stations, [{ lat: 35.68, lon: 139.77, time: t("2026-07-03T12:00") }], t("2026-07-03T09:00"), 25);
    expect(r).toMatchObject({ status: "unavailable", reason: "out_of_season" });
  });

  it("近くに地点が無い・予測時刻外なら値を返さない（温度から計算しない）", () => {
    const table = parseWbgtForecastCsv(csv);
    expect(lookupWbgt(table, stations, [{ lat: 26.2, lon: 127.7, time: t("2026-07-01T12:00") }], t("2026-07-01T08:00"), 25).status).toBe("unavailable");
    expect(lookupWbgt(table, stations, [{ lat: 35.68, lon: 139.77, time: t("2026-07-05T12:00") }], t("2026-07-01T08:00"), 25).status).toBe("unavailable");
  });

  it("指針の区分", () => {
    expect(wbgtLevel(20.9)).toBe("almost_safe");
    expect(wbgtLevel(21)).toBe("caution");
    expect(wbgtLevel(25)).toBe("warning");
    expect(wbgtLevel(28)).toBe("severe_warning");
    expect(wbgtLevel(31)).toBe("danger");
  });
});

describe("ジオコーディング", () => {
  it("無関係な部分一致を除外するための類似度", () => {
    expect(bigramSimilarity("東京駅", "北海道札幌市東区")).toBeLessThan(0.5);
    expect(bigramSimilarity("京都市東山区清水", "京都府京都市東山区清水一丁目")).toBe(1);
  });

  it("OSM の表示名から郵便番号・国名を除く", () => {
    expect(shortenOsmName("東京駅, 丸の内一丁目, 千代田区, 東京都, 100-0005, 日本")).toBe("東京駅 丸の内一丁目 千代田区 東京都");
  });

  it("一方のジオコーダーが失敗しても他方の結果を返し、近い重複をまとめる", async () => {
    const src = { provider: "x", kind: "provider_place" as const };
    const ok = { id: "ok", search: async () => [{ lat: 35.68, lon: 139.76, label: "A", source: src }, { lat: 35.6801, lon: 139.7601, label: "A'", source: src }] };
    const bad = { id: "bad", search: async () => { throw new ProviderError("timeout", "bad"); } };
    const res = await new CompositeGeocoder([bad, ok]).search("A");
    expect(res.map((r) => r.label)).toEqual(["A"]);
    await expect(new CompositeGeocoder([bad]).search("A")).rejects.toBeInstanceOf(ProviderError);
  });

  it("同じ名前で近い候補（同じ駅の別路線など）は1つにまとめる", async () => {
    const src = { provider: "x", kind: "provider_place" as const };
    const ok = {
      id: "ok",
      search: async () => [
        { lat: 34.9846, lon: 135.7584, label: "京都駅", source: src },
        { lat: 34.9858, lon: 135.7588, label: "京都駅", source: src },
        { lat: 34.9858, lon: 135.7688, label: "別の駅", source: src },
      ],
    };
    expect((await new CompositeGeocoder([ok]).search("京都")).map((r) => r.label)).toEqual(["京都駅", "別の駅"]);
  });

  it("Photon: ローマ字でも日本の地名・駅を返し、駅名に「駅」と地域の補足を付ける", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      void url;
      return new Response(
        JSON.stringify({
          features: [
            { geometry: { coordinates: [135.768, 35.0116] }, properties: { name: "京都市", osm_key: "place", osm_value: "city", state: "京都府", countrycode: "JP" } },
            { geometry: { coordinates: [135.7584, 34.9846] }, properties: { name: "京都", osm_key: "railway", osm_value: "station", district: "下京区", city: "京都市", state: "京都府", countrycode: "JP" } },
            { geometry: { coordinates: [126.97, 37.56] }, properties: { name: "Seoul", countrycode: "KR" } },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const g = new PhotonGeocoder({ url: "https://photon.example/api", publicDemo: false }, { timeoutMs: 1000, userAgent: "t" });
    const res = await g.search("kyoto");
    expect(res.map((r) => [r.label, r.detail, r.category])).toEqual([
      ["京都市", "京都府", "area"],
      ["京都駅", "京都府京都市下京区", "station"],
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.searchParams.get("q")).toBe("kyoto");
    expect(url.searchParams.get("bbox")).toBeTruthy();
    expect(url.searchParams.get("lang")).toBeNull();
  });
});

describe("Overpass クエリ", () => {
  it("経路ごとに回廊の検索条件を作る", () => {
    const q = buildCorridorQuery([[[139.7, 35.68], [139.71, 35.68]]], 200);
    expect(q).toContain('way["building"](around:200,35.68000,139.70000');
    expect(q.startsWith("[out:json]")).toBe(true);
  });
});
