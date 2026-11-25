import { describe, expect, it } from "vitest";
import type { LonLat } from "@/lib/domain/types";
import { evaluateSegments, relativeSunSide, roundParts, summariseExposure, vehicleSideExposure } from "@/lib/solar/exposure";
import { clearlyShadierSide, reconcileSideWithMinutes, sideWeight, vehicleSunSide } from "@/lib/solar/side";
import { ShadeModel } from "@/lib/shade/engine";
import { leg, line, route, t } from "./helpers";

const START: LonLat = [139.7, 35.68];

describe("relativeSunSide", () => {
  const sun = (az: number, el: number) => ({ azimuthDeg: az, elevationDeg: el, apparentElevationDeg: el, aboveHorizon: el > 0 });
  it("進行方向に対する太陽の向き", () => {
    expect(relativeSunSide(90, sun(180, 40))).toBe("right"); // 東へ進む・太陽は南
    expect(relativeSunSide(270, sun(180, 40))).toBe("left");
    expect(relativeSunSide(180, sun(180, 40))).toBe("front");
    expect(relativeSunSide(0, sun(180, 40))).toBe("back");
    expect(relativeSunSide(0, sun(180, 80))).toBe("overhead");
    expect(relativeSunSide(0, sun(180, -3))).toBe("none");
  });
});

describe("roundParts", () => {
  it("内訳の分の合計が、全体を丸めた値と一致する", () => {
    // 5.4 + 7.6 + 7.6 = 20.6 分 → 各値を単純に丸めると 5 + 8 + 8 = 21 になってしまう
    const parts = [5.4 * 60, 7.6 * 60, 7.6 * 60];
    const r = roundParts(parts, parts.reduce((a, b) => a + b, 0));
    expect(r.reduce((a, b) => a + b, 0)).toBe(21);
    const exact = [5.4, 7.4, 7.4];
    const tied = roundParts(exact.map((v) => v * 60), 20.2 * 60);
    expect(tied.reduce((a, b) => a + b, 0)).toBe(20);
    tied.forEach((v, i) => expect(Math.abs(v - exact[i]!)).toBeLessThan(1));
    expect(roundParts([0, 0, 0], 0)).toEqual([0, 0, 0]);
  });
});

describe("徒歩経路の日差し推定", () => {
  it("昼間に東へ歩くと、太陽はおおむね右側（南）", () => {
    const r = route("w", [leg("walk", line(START, "east", 1200), t("2026-07-01T12:00"), 900)]);
    const segs = evaluateSegments(r, { shadeModel: null });
    const s = summariseExposure(segs, { hasWeather: false, shadeMissingReason: "shade_data_unavailable" });
    expect(s.outdoorMin).toBe(15);
    expect(s.sunUpOutdoorMin).toBe(15);
    // 7月の正午は太陽が高い（75°以上）ため「ほぼ真上」の時間が多い
    expect(s.relativeSunMin.right + s.relativeSunMin.overhead).toBe(15);
    // 日陰データが無い場合: 日差しの可能性ありと断定せず、不明として扱う
    expect(s.potentialSunMin).toBe(0);
    expect(s.unknownShadeMin).toBe(15);
    expect(s.shadeCoverage).toBe(0);
    expect(s.method.confidence).toBe("low");
    expect(s.method.missingInputs).toContain("weather");
  });

  it("各区間の通過時刻は出発時刻から単調増加し、区間は分解能程度の長さ", () => {
    const r = route("w", [leg("walk", line(START, "north", 2000), t("2026-07-01T09:00"), 1500)]);
    const segs = evaluateSegments(r, { shadeModel: null });
    const times = segs.map((s) => new Date(s.startTime).getTime());
    expect(times.every((v, i) => i === 0 || v > times[i - 1]!)).toBe(true);
    expect(segs[0]!.startTime).toBe("2026-07-01T09:00:00+09:00");
    expect(Math.max(...segs.map((s) => s.durationSec))).toBeLessThan(45);
  });

  it("夜間の経路は太陽が出ている時間 0", () => {
    const r = route("n", [leg("walk", line(START, "east", 800), t("2026-07-01T22:00"), 600)]);
    const s = summariseExposure(evaluateSegments(r, { shadeModel: null }), { hasWeather: true });
    expect(s.sunUpOutdoorMin).toBe(0);
    expect(s.relativeSunMin.none).toBe(10);
    expect(s.method.confidence).toBe("high");
  });

  it("建物の影を区間ごとに反映する（日陰モデルあり）", () => {
    // 経路の南側に沿って高い建物の帯を置く（東西に長い建物）
    const w = 0.02;
    const ring: LonLat[] = [
      [START[0] - 0.001, START[1] - 0.00012],
      [START[0] + w, START[1] - 0.00012],
      [START[0] + w, START[1] - 0.0003],
      [START[0] - 0.001, START[1] - 0.0003],
      [START[0] - 0.001, START[1] - 0.00012],
    ];
    const model = new ShadeModel([{ id: "wall", ring, heightM: 60, heightSource: "height_tag" }]);
    const r = route("s", [leg("walk", line(START, "east", 1000), t("2026-12-15T12:00"), 720)]);
    const s = summariseExposure(evaluateSegments(r, { shadeModel: model }), { hasWeather: true });
    expect(s.shadedMin).toBe(12);
    expect(s.potentialSunMin).toBe(0);
    expect(s.shadeCoverage).toBe(1);
  });
});

describe("列車の左右の日差し", () => {
  it("朝に北へ向かう列車は右側（東）に日が当たり、左側が日陰になりやすい", () => {
    const r = route("t", [leg("rail", line(START, "north", 30_000, 60), t("2026-08-01T07:30"), 1800)]);
    const segs = evaluateSegments(r, { shadeModel: null });
    const [side] = vehicleSideExposure(segs, r);
    expect(side!.rightMin).toBeGreaterThan(25);
    expect(side!.leftMin).toBe(0);
    expect(side!.shadierSide).toBe("left");
  });

  it("曲線区間（往路北行き・後半南行き）では区間ごとの向きで判定し、左右が相殺される", () => {
    const north = line(START, "north", 15_000, 30);
    const back = line(north[north.length - 1]!, "south", 15_000, 30).slice(1);
    const r = route("c", [leg("rail", [...north, ...back], t("2026-08-01T07:30"), 1800)]);
    const [side] = vehicleSideExposure(evaluateSegments(r, { shadeModel: null }), r);
    expect(side!.rightMin).toBeGreaterThan(10);
    expect(side!.leftMin).toBeGreaterThan(10);
    expect(side!.shadierSide).toBe("similar");
  });

  it("夕方に西へ走ると、左前方の低い太陽も左側の日差しとして数え、右側をすすめる（名古屋→京都のケース）", () => {
    // 11月の15:30〜16:30ごろ、太陽は南西（方位約240°）の低い位置。真西（270°）へ走ると太陽は左前方約30°
    const r = route("w", [leg("car", line(START, "west", 60_000, 60), t("2026-11-12T15:30"), 3600)]);
    const segs = evaluateSegments(r, { shadeModel: null });
    const [side] = vehicleSideExposure(segs, r);
    expect(side!.leftMin).toBeGreaterThan(40);
    expect(side!.rightMin).toBe(0);
    expect(side!.shadierSide).toBe("right");
  });

  it("太陽が真正面（±10°以内）なら左右どちらにも数えない", () => {
    expect(vehicleSunSide(240, { aboveHorizon: true, elevationDeg: 8, azimuthDeg: 245 })).toBe("none");
    expect(vehicleSunSide(270, { aboveHorizon: true, elevationDeg: 8, azimuthDeg: 245 })).toBe("left");
    expect(vehicleSunSide(200, { aboveHorizon: true, elevationDeg: 8, azimuthDeg: 245 })).toBe("right");
    expect(vehicleSunSide(270, { aboveHorizon: true, elevationDeg: 65, azimuthDeg: 180 })).toBe("none");
    expect(sideWeight(270, { aboveHorizon: true, elevationDeg: 8, azimuthDeg: 180 })).toBeCloseTo(1);
  });

  it("重み付けの結論を、表示する左右の分数と食い違わないように調整する", () => {
    // はっきり差がある（合計の20%以上・5分以上）なら、重み付けで「差は小さい」でも少ない側
    expect(reconcileSideWithMinutes("similar", 13, 25)).toBe("left");
    expect(reconcileSideWithMinutes("similar", 25, 13)).toBe("right");
    // すすめる側の分数が反対側以上なら「差は小さい」
    expect(reconcileSideWithMinutes("left", 9, 7)).toBe("similar");
    expect(reconcileSideWithMinutes("right", 8, 8)).toBe("similar");
    // 分数と矛盾しなければ重み付けの結論のまま
    expect(reconcileSideWithMinutes("left", 7, 9)).toBe("left");
    expect(reconcileSideWithMinutes("similar", 5, 6)).toBe("similar");
    expect(reconcileSideWithMinutes("unknown", 0, 30)).toBe("unknown");
    // 差が小さいとき（合計の20%未満、または5分未満）ははっきりした側なし
    expect(clearlyShadierSide(50, 60)).toBeNull();
    expect(clearlyShadierSide(1, 4)).toBeNull();
    expect(clearlyShadierSide(10, 18)).toBe("left");
    expect(clearlyShadierSide(0, 5)).toBe("left");
  });

  it("地下鉄はどちら側とも判定しない", () => {
    const r = route("m", [leg("subway", line(START, "north", 10_000), t("2026-08-01T07:30"), 900)]);
    const [side] = vehicleSideExposure(evaluateSegments(r, { shadeModel: null }), r);
    expect(side!.shadierSide).toBe("unknown");
    expect(side!.caveats).toContain("mostly_underground");
  });

  it("徒歩区間（乗り換え）は屋外時間として集計し、車内区間は含めない", () => {
    const w1 = line(START, "east", 300);
    const rail = line(w1[w1.length - 1]!, "north", 10_000);
    const r = route("mix", [leg("walk", w1, t("2026-08-01T10:00"), 240), leg("rail", rail, t("2026-08-01T10:05"), 900)]);
    const segs = evaluateSegments(r, { shadeModel: null });
    expect(segs.filter((s) => !s.outdoor).every((s) => s.shade.reason === "in_vehicle")).toBe(true);
    expect(summariseExposure(segs, { hasWeather: true }).outdoorMin).toBe(4);
    expect(vehicleSideExposure(segs, r)).toHaveLength(1);
  });
});
