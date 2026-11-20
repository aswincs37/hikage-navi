import type { LonLat, ShadeSample, SolarPosition } from "@/lib/domain/types";
import { pointInPolygonXY, rayPolygonDistance, toLocalXY } from "@/lib/geo/geometry";

/**
 * 建物の影による日陰推定（平坦な地面を仮定した2.5次元の光線判定）。
 *
 * 各サンプル点から太陽方位へ水平に半直線を伸ばし、建物の外周と交わる距離 d を求める。
 * 建物高さ H が d・tan(太陽高度) を超えれば、その建物が太陽を遮ると判定する。
 *
 * 判定の原則:
 * - 高さが分かる建物が遮る → "shaded"
 * - 高さ不明の建物が光線上にある（かつ既知の建物では遮られない） → "unknown"
 * - 近くに建物データが全く無い → "unknown"（データが無いことは日なたの根拠にならない）
 * - 光線上に建物が無い → "exposed"（ただし樹木・地形・アーケード等は考慮していない）
 */

export interface Building {
  id: string;
  ring: LonLat[];
  heightM: number | null;
  heightSource: "height_tag" | "levels_estimate" | "none";
}

export interface ShadeModelOptions {
  /** 光線を伸ばす最大距離（m） */
  maxRayM: number;
  /** この高度未満の太陽では影が長すぎて判定できないため unknown とする（度） */
  minSunElevationDeg: number;
  /** この半径内に建物が1つも無ければ「建物データなし」とする（m） */
  coverageRadiusM: number;
  /** 判定点の高さ（m）。既定は地表 0 m */
  observerHeightM: number;
  /**
   * 光線の届く範囲（maxRayM）の外にある建物でも影を落としうる高さの目安（m）。
   * maxRayM・tan(太陽高度) がこれ未満なら、範囲外の建物の影を否定できないため unknown とする。
   */
  distantObstructionHeightM: number;
}

export const DEFAULT_SHADE_OPTIONS: ShadeModelOptions = {
  maxRayM: 200,
  minSunElevationDeg: 3,
  coverageRadiusM: 100,
  observerHeightM: 0,
  distantObstructionHeightM: 40,
};

/** 建物を取得する回廊の半径。光線の最大長と一致させる */
export const SHADE_CORRIDOR_M = DEFAULT_SHADE_OPTIONS.maxRayM;

interface PreparedBuilding {
  b: Building;
  xy: [number, number][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class ShadeModel {
  private readonly origin: LonLat;
  private readonly prepared: PreparedBuilding[];

  constructor(
    buildings: Building[],
    private readonly options: ShadeModelOptions = DEFAULT_SHADE_OPTIONS,
  ) {
    const first = buildings[0]?.ring[0];
    this.origin = first ?? [0, 0];
    this.prepared = buildings
      .filter((b) => b.ring.length >= 3)
      .map((b) => {
        const xy = b.ring.map((p) => toLocalXY(this.origin, p));
        const xs = xy.map((p) => p[0]);
        const ys = xy.map((p) => p[1]);
        return { b, xy, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
      });
  }

  get buildingCount(): number {
    return this.prepared.length;
  }

  evaluate(point: LonLat, sun: SolarPosition): ShadeSample {
    if (!sun.aboveHorizon) return { state: "night", reason: "sun_below_horizon" };
    if (sun.elevationDeg < this.options.minSunElevationDeg) return { state: "unknown", reason: "sun_too_low" };

    const [px, py] = toLocalXY(this.origin, point);
    const R = this.options.maxRayM;
    const near = this.prepared.filter(
      (p) => p.maxX >= px - R && p.minX <= px + R && p.maxY >= py - R && p.minY <= py + R,
    );

    const cov = this.options.coverageRadiusM;
    const hasCoverage = near.some(
      (p) => p.maxX >= px - cov && p.minX <= px + cov && p.maxY >= py - cov && p.minY <= py + cov,
    );

    const az = (sun.azimuthDeg * Math.PI) / 180;
    const dir: [number, number] = [Math.sin(az), Math.cos(az)];
    const tanEl = Math.tan((sun.elevationDeg * Math.PI) / 180);

    let unknownHit = false;
    for (const p of near) {
      const ring = p.xy.map(([x, y]) => [x - px, y - py] as [number, number]);
      if (pointInPolygonXY([0, 0], ring)) {
        // 経路が建物の輪郭内を通る（駅舎・アーケード・屋根付き通路など）。高さに関係なく覆われていると推定
        return { state: "shaded", reason: "inside_building", usedEstimatedHeight: p.b.heightSource !== "height_tag" };
      }
      const d = rayPolygonDistance(dir, ring, R);
      if (d === null) continue;
      if (p.b.heightM === null) {
        unknownHit = true;
        continue;
      }
      if (p.b.heightM - this.options.observerHeightM > d * tanEl) {
        return { state: "shaded", reason: "building_shadow", usedEstimatedHeight: p.b.heightSource === "levels_estimate" };
      }
    }
    if (unknownHit) return { state: "unknown", reason: "obstruction_height_unknown" };
    if (!hasCoverage) return { state: "unknown", reason: "no_building_data" };
    if (R * tanEl < this.options.distantObstructionHeightM) return { state: "unknown", reason: "sun_too_low" };
    return { state: "exposed", reason: "no_obstruction_found" };
  }
}

/** OSM の height タグ（"12", "12 m", "12.5m"）を m に変換。単位がメートル以外なら null */
export function parseHeightTag(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m)?\s*$/i.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  return h > 0 && h < 700 ? h : null;
}

/** 1階あたりの高さの仮定値（m）。階数からの推定は "levels_estimate" として区別する */
export const ASSUMED_STOREY_HEIGHT_M = 3;

export function buildingHeightFromTags(tags: Record<string, string>): Pick<Building, "heightM" | "heightSource"> {
  const h = parseHeightTag(tags["height"]);
  if (h !== null) return { heightM: h, heightSource: "height_tag" };
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0 && levels < 200) {
    return { heightM: levels * ASSUMED_STOREY_HEIGHT_M, heightSource: "levels_estimate" };
  }
  return { heightM: null, heightSource: "none" };
}
