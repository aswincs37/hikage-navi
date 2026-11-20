import { describe, expect, it } from "vitest";
import type { LonLat, SolarPosition } from "@/lib/domain/types";
import { buildingHeightFromTags, parseHeightTag, ShadeModel, type Building } from "@/lib/shade/engine";
import { parseOverpassBuildings } from "@/lib/providers/overpass";

const P: LonLat = [139.7, 35.68];
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LON = 111_195 * Math.cos((35.68 * Math.PI) / 180);

/** P を基準に、東へ dx m・北へ dy m の位置に幅 w・奥行き d の長方形の建物を置く */
function box(id: string, dx: number, dy: number, w: number, d: number, heightM: number | null, source: Building["heightSource"] = "height_tag"): Building {
  const toLL = (x: number, y: number): LonLat => [P[0] + x / M_PER_DEG_LON, P[1] + y / M_PER_DEG_LAT];
  const ring = [toLL(dx - w / 2, dy), toLL(dx + w / 2, dy), toLL(dx + w / 2, dy + d), toLL(dx - w / 2, dy + d), toLL(dx - w / 2, dy)];
  return { id, ring, heightM, heightSource: heightM === null ? "none" : source };
}

const sun = (azimuthDeg: number, elevationDeg: number): SolarPosition => ({
  azimuthDeg,
  elevationDeg,
  apparentElevationDeg: elevationDeg,
  aboveHorizon: elevationDeg > 0,
});

// 太陽は真南、高度45°。建物は判定点の南10m（dy=-10 から南へ奥行き10m）
const south = (h: number | null, src?: Building["heightSource"]) => box("s", 0, -20, 20, 10, h, src);

describe("ShadeModel", () => {
  it("南側10mにある高さ20mの建物は、高度45°の太陽を遮る", () => {
    const m = new ShadeModel([south(20)]);
    expect(m.evaluate(P, sun(180, 45))).toEqual({ state: "shaded", reason: "building_shadow", usedEstimatedHeight: false });
  });

  it("同じ位置でも高さ5mの建物は遮らない（10m × tan45° = 10m > 5m）", () => {
    const m = new ShadeModel([south(5)]);
    expect(m.evaluate(P, sun(180, 45))).toEqual({ state: "exposed", reason: "no_obstruction_found" });
  });

  it("太陽が北側にあれば南の建物は影を落とさない", () => {
    const m = new ShadeModel([south(50)]);
    expect(m.evaluate(P, sun(0, 45)).state).toBe("exposed");
  });

  it("高さ不明の建物が光線上にあれば unknown（日なたとはしない）", () => {
    const m = new ShadeModel([south(null)]);
    expect(m.evaluate(P, sun(180, 45))).toEqual({ state: "unknown", reason: "obstruction_height_unknown" });
  });

  it("既知の建物で遮られていれば、他に高さ不明の建物があっても shaded", () => {
    const m = new ShadeModel([box("u", 0, -40, 20, 10, null), south(20)]);
    expect(m.evaluate(P, sun(180, 45)).state).toBe("shaded");
  });

  it("近くに建物データが無ければ unknown（データ欠損を日なたとみなさない）", () => {
    const far = box("far", 1000, 1000, 10, 10, 10);
    const m = new ShadeModel([far]);
    expect(m.evaluate(P, sun(180, 45))).toEqual({ state: "unknown", reason: "no_building_data" });
    expect(new ShadeModel([]).evaluate(P, sun(180, 45)).reason).toBe("no_building_data");
  });

  it("階数からの推定高さを使った場合は印を付ける", () => {
    const m = new ShadeModel([south(30, "levels_estimate")]);
    expect(m.evaluate(P, sun(180, 45)).usedEstimatedHeight).toBe(true);
  });

  it("経路が建物の輪郭内（屋根付き通路など）なら shaded", () => {
    const m = new ShadeModel([box("c", 0, -5, 10, 10, 4)]);
    expect(m.evaluate(P, sun(180, 60)).reason).toBe("inside_building");
  });

  it("夜間は night、低い太陽は unknown", () => {
    const m = new ShadeModel([south(20)]);
    expect(m.evaluate(P, sun(270, -5)).state).toBe("night");
    expect(m.evaluate(P, sun(270, 2)).reason).toBe("sun_too_low");
  });

  it("太陽が低く、範囲外の建物の影を否定できない場合は unknown", () => {
    // 東側に建物があるが光線（西向き）上には無い。高度8°: 200m × tan8° ≈ 28m < 40m
    const m = new ShadeModel([box("e", 30, -5, 10, 10, 10)]);
    expect(m.evaluate(P, sun(270, 8))).toEqual({ state: "unknown", reason: "sun_too_low" });
    expect(m.evaluate(P, sun(270, 20)).state).toBe("exposed");
  });
});

describe("建物の高さ", () => {
  it("height タグを解釈する", () => {
    expect(parseHeightTag("12")).toBe(12);
    expect(parseHeightTag("12.5 m")).toBe(12.5);
    expect(parseHeightTag("40 ft")).toBeNull();
    expect(parseHeightTag("tall")).toBeNull();
    expect(parseHeightTag(undefined)).toBeNull();
  });

  it("階数から推定し、出典を区別する", () => {
    expect(buildingHeightFromTags({ height: "20" })).toEqual({ heightM: 20, heightSource: "height_tag" });
    expect(buildingHeightFromTags({ "building:levels": "4" })).toEqual({ heightM: 12, heightSource: "levels_estimate" });
    expect(buildingHeightFromTags({ building: "yes" })).toEqual({ heightM: null, heightSource: "none" });
  });

  it("Overpass の応答から閉じた輪郭だけを建物として取り込む", () => {
    const b = parseOverpassBuildings([
      {
        type: "way",
        id: 1,
        tags: { building: "yes", height: "15" },
        geometry: [
          { lat: 35, lon: 139 },
          { lat: 35, lon: 139.001 },
          { lat: 35.001, lon: 139.001 },
          { lat: 35, lon: 139 },
        ],
      },
      { type: "way", id: 2, tags: { building: "yes" }, geometry: [{ lat: 35, lon: 139 }, { lat: 35, lon: 139.001 }] },
    ]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ id: "way/1", heightM: 15, heightSource: "height_tag" });
  });
});
