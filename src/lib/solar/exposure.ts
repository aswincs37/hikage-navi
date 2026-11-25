import { reconcileSideWithMinutes, sideWeight, vehicleSunSide } from "./side";
import type {
  CalculationMetadata,
  ExposureSummary,
  RelativeSunSide,
  RouteAlternative,
  SegmentEstimate,
  ShadeSample,
  SolarPosition,
  SourceRef,
  VehicleSideExposure,
} from "@/lib/domain/types";
import { angleDiffDeg, mergePiecesByDuration, splitLine } from "@/lib/geo/geometry";
import type { ShadeModel } from "@/lib/shade/engine";
import { addSeconds, toTokyoIso } from "@/lib/time/tokyo";
import { SOLAR_LIBRARY, solarPosition } from "./position";

/**
 * 経路区間ごとの日差し推定。
 *
 * 1. 経路の形状を短い区間に分割し、各区間を通過する時刻を推定する
 * 2. 区間の中点・通過時刻で太陽位置を計算する（天文計算）
 * 3. 屋外区間は、建物データがあれば建物の影を判定する（モデル推定）
 * 4. 雲による遮蔽は「直射日光の可能性」には含めず、雲量として別に表示する
 */

/** 屋外区間の時間分解能（秒）。これより細かい精度は主張しない */
export const OUTDOOR_RESOLUTION_SEC = 30;
/** 車内区間の時間分解能（秒） */
export const VEHICLE_RESOLUTION_SEC = 60;
/** これより高い太陽は「ほぼ真上」とし、前後左右の区別をしない（度） */
export const OVERHEAD_ELEVATION_DEG = 75;
/** 1経路あたりの最大区間数（計算量の上限） */
const MAX_SEGMENTS_PER_LEG = 600;

export interface SegmentOptions {
  /** 屋外区間に使う日陰モデル。null なら日陰は "unknown" */
  shadeModel: ShadeModel | null;
  /** shadeModel が null の理由 */
  shadeUnavailableReason?: ShadeSample["reason"];
  /** 出発時刻をずらして再計算する場合の秒数 */
  timeShiftSec?: number;
}

export function relativeSunSide(bearingDeg: number, sun: SolarPosition): RelativeSunSide {
  if (!sun.aboveHorizon) return "none";
  if (sun.elevationDeg >= OVERHEAD_ELEVATION_DEG) return "overhead";
  const d = angleDiffDeg(bearingDeg, sun.azimuthDeg);
  if (d > -45 && d <= 45) return "front";
  if (d > 45 && d <= 135) return "right";
  if (d < -45 && d >= -135) return "left";
  return "back";
}

export function evaluateSegments(route: RouteAlternative, opts: SegmentOptions): SegmentEstimate[] {
  const out: SegmentEstimate[] = [];
  const shift = opts.timeShiftSec ?? 0;
  route.legs.forEach((leg, legIndex) => {
    const legStart = addSeconds(new Date(leg.startTime), shift);
    const pieces = splitLine(leg.geometry, leg.vertexOffsetsSec, leg.outdoor ? 20 : 200);
    let target = leg.outdoor ? OUTDOOR_RESOLUTION_SEC : VEHICLE_RESOLUTION_SEC;
    // 非常に長い区間では、区間数が上限を超えないよう時間幅を広げる
    target = Math.max(target, Math.ceil(leg.durationSec / MAX_SEGMENTS_PER_LEG));
    const merged = mergePiecesByDuration(pieces, target);

    for (const p of merged) {
      const at = addSeconds(legStart, p.startOffsetSec + p.durationSec / 2);
      const [lon, lat] = p.mid;
      const sun = solarPosition(lat, lon, at);
      let shade: ShadeSample;
      if (!sun.aboveHorizon) shade = { state: "night", reason: "sun_below_horizon" };
      else if (!leg.outdoor) shade = { state: "unknown", reason: "in_vehicle" };
      else if (opts.shadeModel) shade = opts.shadeModel.evaluate(p.mid, sun);
      else shade = { state: "unknown", reason: opts.shadeUnavailableReason ?? "shade_data_unavailable" };

      out.push({
        index: out.length,
        legIndex,
        lat,
        lon,
        startTime: toTokyoIso(addSeconds(legStart, p.startOffsetSec)),
        durationSec: p.durationSec,
        distanceM: p.distanceM,
        outdoor: leg.outdoor,
        bearingDeg: Math.round(p.bearingDeg),
        sun,
        relativeSun: relativeSunSide(p.bearingDeg, sun),
        shade,
      });
    }
  });
  return out;
}

/** 分に丸める。分解能より細かい値を出さない */
function toMin(sec: number): number {
  return Math.round(sec / 60);
}

/** 内訳を分に丸め、合計が全体の丸め値と一致するよう最大剰余法で調整する */
export function roundParts(parts: number[], totalSec: number): number[] {
  const total = toMin(totalSec);
  const exact = parts.map((p) => p / 60);
  const floors = exact.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]!++;
    rest--;
  }
  return floors;
}

export function summariseExposure(
  segments: SegmentEstimate[],
  context: { shadeSource?: SourceRef; shadeMissingReason?: string; hasWeather: boolean },
): ExposureSummary {
  let outdoor = 0;
  let sunUp = 0;
  let exposed = 0;
  let shaded = 0;
  let unknown = 0;
  let usedEstimatedHeight = false;
  const rel: Record<RelativeSunSide, number> = { front: 0, right: 0, back: 0, left: 0, overhead: 0, none: 0 };
  for (const s of segments) {
    if (!s.outdoor) continue;
    outdoor += s.durationSec;
    rel[s.relativeSun] += s.durationSec;
    if (!s.sun.aboveHorizon) continue;
    sunUp += s.durationSec;
    if (s.shade.state === "shaded") shaded += s.durationSec;
    else if (s.shade.state === "exposed") exposed += s.durationSec;
    else unknown += s.durationSec;
    if (s.shade.usedEstimatedHeight) usedEstimatedHeight = true;
  }

  const assumptions = [
    "flat_terrain",
    "segment_time_from_provider_duration",
    "clouds_not_included_in_potential_sun",
    "trees_not_modelled",
  ];
  if (usedEstimatedHeight) assumptions.push("height_from_levels_3m");
  const missing: string[] = [];
  if (context.shadeMissingReason) missing.push(`shade:${context.shadeMissingReason}`);
  if (!context.hasWeather) missing.push("weather");
  missing.push("terrain_elevation", "tree_canopy");

  const coverage = sunUp > 0 ? (exposed + shaded) / sunUp : 0;
  const confidence: CalculationMetadata["confidence"] =
    sunUp === 0 ? "high" : coverage >= 0.8 && !usedEstimatedHeight ? "medium" : "low";

  const [exposedMin, shadedMin, unknownMin] = roundParts([exposed, shaded, unknown], sunUp);
  return {
    outdoorMin: toMin(outdoor),
    sunUpOutdoorMin: toMin(sunUp),
    // 日陰判定できなかった時間は「日差しの可能性あり」に含めず、別に unknown として示す
    potentialSunMin: exposedMin!,
    shadedMin: shadedMin!,
    unknownShadeMin: unknownMin!,
    shadeCoverage: Math.round(coverage * 100) / 100,
    relativeSunMin: Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, toMin(v)])) as Record<RelativeSunSide, number>,
    resolutionSec: OUTDOOR_RESOLUTION_SEC,
    method: {
      method: "segment_solar_position_with_building_ray_test",
      library: SOLAR_LIBRARY,
      inputs: ["route_geometry", "segment_traversal_time", "solar_position", ...(context.shadeSource ? ["osm_buildings"] : [])],
      missingInputs: missing,
      assumptions,
      sources: [
        { provider: "astronomy-engine", kind: "astronomical" },
        ...(context.shadeSource ? [context.shadeSource] : []),
      ],
      confidence,
    },
  };
}

/**
 * 列車・バス・自動車の左右どちら側に日が当たりやすいかの推定。
 * 太陽が進行方向の真正面・真後ろ（±10°）以外なら左右どちらかに差し込むとみなし、その時間を数える
 * （西へ走る夕方の「左前方の低い太陽」も左側として数える。判定は ./side.ts）。
 * どちらの側がおすすめかは、横向きの成分（sin）で重み付けした量で比べる。
 * 太陽が高い場合（60°以上）は窓からの差し込みが少ないため左右を区別しない。
 */
const LOW_SUN_DEG = 15;
/** 重み付けした左右の合計がこれ（秒）未満なら、どちらでも差がないとする */
const MIN_WEIGHTED_SIDE_SEC = 120;
/** 左右の差が合計のこの割合未満なら「どちらも同じくらい」 */
const SIMILAR_RATIO = 0.2;

export function vehicleSideExposure(segments: SegmentEstimate[], route: RouteAlternative): VehicleSideExposure[] {
  const result: VehicleSideExposure[] = [];
  route.legs.forEach((leg, legIndex) => {
    if (leg.outdoor) return;
    let left = 0;
    let right = 0;
    let leftW = 0;
    let rightW = 0;
    let frontBack = 0;
    let low = 0;
    let night = 0;
    let total = 0;
    for (const s of segments) {
      if (s.legIndex !== legIndex) continue;
      total += s.durationSec;
      if (!s.sun.aboveHorizon) {
        night += s.durationSec;
        continue;
      }
      if (s.sun.elevationDeg < LOW_SUN_DEG) low += s.durationSec;
      const side = vehicleSunSide(s.bearingDeg, s.sun);
      const w = sideWeight(s.bearingDeg, s.sun) * s.durationSec;
      if (side === "right") {
        right += s.durationSec;
        rightW += w;
      } else if (side === "left") {
        left += s.durationSec;
        leftW += w;
      } else frontBack += s.durationSec;
    }
    const caveats = ["clouds", "buildings_and_terrain", "tunnels_not_modelled", "seat_orientation"];
    if (leg.mode === "subway") caveats.unshift("mostly_underground");
    if (leg.mode === "car") caveats.push("vehicle_glazing");
    if (leg.mode === "bus" || leg.mode === "car") caveats.push("road_route_approximation");

    const weighted = leftW + rightW;
    let shadierSide: VehicleSideExposure["shadierSide"];
    if (leg.mode === "subway") shadierSide = "unknown";
    else if (weighted < MIN_WEIGHTED_SIDE_SEC) shadierSide = "similar";
    else if (Math.abs(leftW - rightW) < weighted * SIMILAR_RATIO) shadierSide = "similar";
    else shadierSide = leftW < rightW ? "left" : "right";
    const leftMin = toMin(left);
    const rightMin = toMin(right);
    // 結論は、利用者に表示する左右の分数と矛盾させない
    shadierSide = reconcileSideWithMinutes(shadierSide, leftMin, rightMin);

    result.push({
      legIndex,
      leftMin,
      rightMin,
      frontOrBackMin: toMin(frontBack),
      lowSunMin: toMin(low),
      nightMin: toMin(night),
      totalMin: toMin(total),
      shadierSide,
      caveats,
    });
  });
  return result;
}
