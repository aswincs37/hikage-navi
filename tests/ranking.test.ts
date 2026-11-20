import { describe, expect, it } from "vitest";
import type { EvaluatedRoute, ExposureSummary } from "@/lib/domain/types";
import { rankRoutes } from "@/lib/ranking/rank";
import { unavailable } from "@/lib/domain/types";

function evaluated(
  id: string,
  o: { durationMin: number; walkingMin?: number; transfers?: number } & Partial<ExposureSummary>,
): EvaluatedRoute {
  const exposure: ExposureSummary = {
    outdoorMin: o.outdoorMin ?? o.durationMin,
    sunUpOutdoorMin: o.sunUpOutdoorMin ?? o.durationMin,
    potentialSunMin: o.potentialSunMin ?? 0,
    shadedMin: o.shadedMin ?? 0,
    unknownShadeMin: o.unknownShadeMin ?? 0,
    shadeCoverage: o.shadeCoverage ?? 0,
    relativeSunMin: { front: 0, right: 0, back: 0, left: 0, overhead: 0, none: 0 },
    resolutionSec: 30,
    method: { method: "test", inputs: [], missingInputs: [], assumptions: [], sources: [], confidence: "low" },
  };
  return {
    route: {
      id,
      mode: "train",
      legs: [],
      startTime: "",
      endTime: "",
      durationSec: o.durationMin * 60,
      distanceM: 0,
      walkingSec: (o.walkingMin ?? 0) * 60,
      transfers: o.transfers,
      source: { provider: "test", kind: "provider_route" },
    },
    segments: [],
    exposure,
    vehicleSides: [],
    weather: { samples: unavailable("not_configured"), wbgt: unavailable("not_configured") },
    heatWarnings: [],
  };
}

describe("rankRoutes", () => {
  it("所要時間優先なら速い経路が1位、理由に差分を示す", () => {
    const r = rankRoutes([evaluated("slow", { durationMin: 30 }), evaluated("fast", { durationMin: 20 })], ["minimise_time"]);
    expect(r.ranked[0]!.routeId).toBe("fast");
    expect(r.ranked[0]!.reasons).toEqual([{ code: "shorter_duration", diff: 10, unit: "min" }]);
    expect(r.ranked[0]!.score).toBe(100);
    expect(r.ranked[1]!.score).toBe(0);
  });

  it("日差しを避けたい場合、日陰の多い（日差し可能性の少ない）経路を優先する", () => {
    const sunny = evaluated("sunny", { durationMin: 20, sunUpOutdoorMin: 20, shadedMin: 2, shadeCoverage: 1 });
    const shady = evaluated("shady", { durationMin: 23, sunUpOutdoorMin: 23, shadedMin: 15, shadeCoverage: 1 });
    const r = rankRoutes([sunny, shady], ["minimise_sun"]);
    expect(r.ranked[0]!.routeId).toBe("shady");
    expect(r.ranked[0]!.reasons[0]).toMatchObject({ code: "less_sun", diff: 10 });
  });

  it("日陰データが無い時間は日差しの可能性ありとして扱い、データ欠損で有利にならない", () => {
    const known = evaluated("known", { durationMin: 20, sunUpOutdoorMin: 20, shadedMin: 10, shadeCoverage: 1 });
    const unknownShade = evaluated("unknown", { durationMin: 20, sunUpOutdoorMin: 20, shadedMin: 0, unknownShadeMin: 20, shadeCoverage: 0 });
    expect(rankRoutes([unknownShade, known], ["minimise_sun"]).ranked[0]!.routeId).toBe("known");
  });

  it("日陰の割合が一部の候補で不明なら、その候補を最も不利として扱い明示する", () => {
    const known = evaluated("known", { durationMin: 20, sunUpOutdoorMin: 20, shadedMin: 4, shadeCoverage: 1 });
    const missing = evaluated("missing", { durationMin: 20, sunUpOutdoorMin: 20, shadeCoverage: 0 });
    const r = rankRoutes([missing, known], ["prefer_shade"]);
    expect(r.ranked[0]!.routeId).toBe("known");
    expect(r.ranked.find((x) => x.routeId === "missing")!.metricsMissing).toEqual(["shadedShare"]);
  });

  it("全候補で日陰データが無ければ、その希望条件は反映せず理由を返す", () => {
    const r = rankRoutes([evaluated("a", { durationMin: 20 }), evaluated("b", { durationMin: 25 })], ["prefer_shade"]);
    expect(r.appliedPreferences).toEqual([]);
    expect(r.ignoredPreferences).toEqual([{ preference: "prefer_shade", reason: "no_data" }]);
    expect(r.ranked[0]!.score).toBeNull();
  });

  it("景観優先はデータが無いため反映しない。乗り換え回数の情報が無ければ対象外", () => {
    const r = rankRoutes([evaluated("a", { durationMin: 20 }), evaluated("b", { durationMin: 25 })], ["scenic", "fewer_transfers", "minimise_time"]);
    expect(r.ignoredPreferences).toEqual([
      { preference: "scenic", reason: "no_data" },
      { preference: "fewer_transfers", reason: "not_applicable" },
    ]);
    expect(r.appliedPreferences).toEqual(["minimise_time"]);
  });

  it("小さな差は理由として示さない", () => {
    const r = rankRoutes([evaluated("a", { durationMin: 20 }), evaluated("b", { durationMin: 21 })], ["minimise_time"]);
    expect(r.ranked[0]!.reasons).toEqual([]);
  });

  it("候補が1件なら比較できないことを示す", () => {
    const r = rankRoutes([evaluated("only", { durationMin: 20 })], []);
    expect(r.ranked[0]!.reasons).toEqual([{ code: "only_option" }]);
    expect(r.ranked[0]!.score).toBeNull();
    expect(r.appliedPreferences).toEqual(["balanced"]);
  });

  it("乗り換えの少なさを優先できる", () => {
    const r = rankRoutes(
      [evaluated("two", { durationMin: 30, transfers: 2 }), evaluated("zero", { durationMin: 35, transfers: 0 })],
      ["fewer_transfers"],
    );
    expect(r.ranked[0]!.routeId).toBe("zero");
    expect(r.ranked[0]!.reasons[0]).toEqual({ code: "fewer_transfers", diff: 2, unit: "count" });
  });

  it("候補が無ければ空", () => {
    expect(rankRoutes([], ["balanced"]).ranked).toEqual([]);
  });
});
