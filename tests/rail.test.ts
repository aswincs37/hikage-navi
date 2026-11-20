import { describe, expect, it } from "vitest";
import { operatorKey, railNetworkFromRaw, type RawNetwork } from "@/lib/providers/rail/network";
import { OsmRailTransitProvider, planRail } from "@/lib/providers/rail/osmRail";
import { searchJourney } from "@/lib/journey/search";
import type { Providers } from "@/lib/providers/registry";
import { evaluateSegments, vehicleSideExposure } from "@/lib/solar/exposure";
import { t } from "./helpers";

/**
 * 合成の線路網（実在の路線ではない）:
 *   東西線 A: (139.70, 35.68) → (139.74, 35.68)   駅 S1（西端近く）、X（中央）
 *   南北線 B: (139.72, 35.70) → (139.72, 35.66)   駅 X（中央、A と交差）、S2（南端近く）
 * A と B は線路を共有しないため、X で乗り換える必要がある。
 */
const P = (lon: number, lat: number) => [Math.round(lon * 1e5), Math.round(lat * 1e5)] as const;
const raw: RawNetwork = {
  v: 1,
  generated: "test",
  attribution: "test",
  nodes: [...P(139.7, 35.68), ...P(139.74, 35.68), ...P(139.72, 35.7), ...P(139.72, 35.66)],
  edges: {
    a: [0, 2],
    b: [1, 3],
    len: [3620, 4450],
    cls: [1, 1],
    name: [0, 1],
    tunnel: [0, 0],
    geom: [[], []],
  },
  names: ["A線", "B線"],
  stations: [
    ["S1", "S1", ...P(139.701, 35.68), 0],
    ["X", "X", ...P(139.72, 35.6802), 0],
    ["S2", "S2", ...P(139.72, 35.661), 0],
  ],
};
const net = railNetworkFromRaw(raw);
const DEP = t("2026-11-18T15:00");

describe("OpenStreetMap の線路による電車の経路（推定）", () => {
  it("近くの駅まで歩き、線路に沿って乗り、交差する駅で乗り換える", () => {
    const r = planRail(net, { lat: 35.68, lon: 139.6975, label: "出発地" }, { lat: 35.661, lon: 139.72, label: "S2" }, DEP)!;
    expect(r).not.toBeNull();
    expect(r.legs.map((l) => [l.mode, l.fromName, l.toName, l.routeName])).toEqual([
      ["walk", "出発地", "S1", undefined],
      ["rail", "S1", "X", "A線"],
      ["rail", "X", "S2", "B線"],
    ]);
    expect(r.transfers).toBe(1);
    expect(r.source.kind).toBe("estimate");
    // 時刻は単調に進み、乗り換え・待ち時間がある
    const times = r.legs.flatMap((l) => [new Date(l.startTime).getTime(), new Date(l.endTime).getTime()]);
    expect(times.every((v, i) => i === 0 || v >= times[i - 1]!)).toBe(true);
    expect(r.waitingSec).toBeGreaterThan(0);
    // 乗車区間の形状: A は東向き、B は南向き。各頂点に通過時刻がある
    const [, a, b] = r.legs;
    expect(a!.geometry[a!.geometry.length - 1]![0]).toBeGreaterThan(a!.geometry[0]![0]);
    expect(b!.geometry[b!.geometry.length - 1]![1]).toBeLessThan(b!.geometry[0]![1]);
    expect(a!.vertexOffsetsSec).toHaveLength(a!.geometry.length);
    expect(Math.round(a!.distanceM)).toBeGreaterThan(1500);
  });

  it("乗車区間ごとに座席の左右を判定できる（午後に南へ向かう B 線は西＝右側に日が当たる）", () => {
    const r = planRail(net, { lat: 35.68, lon: 139.701 }, { lat: 35.661, lon: 139.72 }, DEP)!;
    const sides = vehicleSideExposure(evaluateSegments(r, { shadeModel: null }), r);
    expect(sides).toHaveLength(2);
    const south = sides.find((s) => r.legs[s.legIndex]!.routeName === "B線")!;
    expect(south.rightMin).toBeGreaterThan(0);
    expect(south.leftMin).toBe(0);
  });

  it("駅と線路の運営会社が分かるときは、同じ会社の線路だけがその駅に停まる", () => {
    // 交差点の駅 X を「A社」の駅にし、A線＝A社、B線＝B社とする → B線は X に停まらず、A線から B線へ乗り換えられない
    const withOps: RawNetwork = {
      ...raw,
      edges: { ...raw.edges, op: [2, 3] },
      names: [...raw.names, "A社", "B社"],
      stations: raw.stations.map((st) => (st[0] === "X" ? [...st.slice(0, 5), "A社"] : st) as RawNetwork["stations"][number]),
    };
    const n2 = railNetworkFromRaw(withOps);
    expect(planRail(n2, { lat: 35.68, lon: 139.701 }, { lat: 35.661, lon: 139.72 }, DEP)).toBeNull();
    // 会社名の表記揺れ: JR 各社はまとめて同じ会社とみなす
    expect(operatorKey("東日本旅客鉄道")).toBe(operatorKey("JR東海"));
    expect(operatorKey("東京メトロ")).toBe(operatorKey("東京地下鉄"));
    expect(operatorKey("京浜急行電鉄")).not.toBe(operatorKey("東日本旅客鉄道"));
  });

  it("近くに駅が無ければ経路なし", () => {
    expect(planRail(net, { lat: 36.5, lon: 139.7 }, { lat: 35.661, lon: 139.72 }, DEP)).toBeNull();
  });

  it("推定の電車はバスには使わない（バスは未対応と表示）", async () => {
    const providers: Providers = {
      geocoder: null,
      suggester: null,
      street: { car: null },
      transit: new OsmRailTransitProvider(net),
      weather: null,
      wbgt: null,
      shade: null,
      shadeMaxRouteKm: 5,
      weatherMaxLeadDays: 7,
      configNotices: [],
    };
    const base = { origin: { lat: 35.68, lon: 139.701 }, destination: { lat: 35.661, lon: 139.72 }, departure: DEP, preferences: [] };
    expect((await searchJourney({ ...base, mode: "bus" }, providers, DEP)).status).toBe("unsupported");
    const train = await searchJourney({ ...base, mode: "train" }, providers, DEP);
    expect(train.status).toBe("ok");
    expect(train.routes[0]!.vehicleSides.length).toBe(2);
  });
});
