import { angleDiffDeg } from "@/lib/geo/geometry";

/**
 * 乗り物の左右どちらに日が差すかの判定（エンジンと地図の色分けで共通）。
 *
 * 太陽が進行方向のほぼ真正面・真後ろ（±10°以内）でなければ、左右どちらかの成分がある。
 * 正面寄り（例: 左前方 20°）の低い太陽も、左側の窓・左側の席に差し込むため「左」として数える。
 * ただし真横ほど強くはないので、どちらの側がおすすめかは sin（横向きの成分）で重み付けして決める。
 * 太陽が高い（60°以上）と窓からの差し込みは少ないため、左右を区別しない。
 */
export const SIDE_DEAD_ZONE_DEG = 10;
export const HIGH_SUN_DEG = 60;

export interface SunLike {
  aboveHorizon: boolean;
  elevationDeg: number;
  azimuthDeg: number;
}

export type VehicleSunSide = "left" | "right" | "none";

/** 進行方向に対する太陽の向き（-180〜180、右が正） */
export function sunAngleFromHeading(bearingDeg: number, sun: SunLike): number {
  return angleDiffDeg(bearingDeg, sun.azimuthDeg);
}

export function vehicleSunSide(bearingDeg: number, sun: SunLike): VehicleSunSide {
  if (!sun.aboveHorizon || sun.elevationDeg >= HIGH_SUN_DEG) return "none";
  const d = sunAngleFromHeading(bearingDeg, sun);
  const abs = Math.abs(d);
  if (abs < SIDE_DEAD_ZONE_DEG || abs > 180 - SIDE_DEAD_ZONE_DEG) return "none";
  return d > 0 ? "right" : "left";
}

/** 表示する分数で「はっきり差がある」とみなす基準: 差が左右合計の20%以上（エンジンの重み付け判定と同じ割合）、かつ5分以上 */
const CLEAR_SHARE = 0.2;
const CLEAR_DIFF_MIN = 5;

/** 表示する左右の分数ではっきり日差しが少ない側。差がはっきりしなければ null */
export function clearlyShadierSide(leftMin: number, rightMin: number): "left" | "right" | null {
  const diff = Math.abs(leftMin - rightMin);
  if (diff < CLEAR_DIFF_MIN || diff < (leftMin + rightMin) * CLEAR_SHARE) return null;
  return leftMin < rightMin ? "left" : "right";
}

/**
 * 横向きの成分で重み付けした結論を、画面に表示する左右の分数と食い違わないように調整する。
 * - 分数ではっきり差があれば、日差しの少ない側をすすめる（「差は小さい」と言いながら 13分 対 25分 と表示しない）
 * - すすめる側の分数が反対側以上なら「差は小さい」にする（日差しの多い側をすすめない）
 */
export function reconcileSideWithMinutes<T extends "left" | "right" | "similar" | "unknown">(
  side: T,
  leftMin: number,
  rightMin: number,
): T | "left" | "right" | "similar" {
  if (side === "unknown") return side;
  const clear = clearlyShadierSide(leftMin, rightMin);
  if (clear) return clear;
  if (side === "left" && leftMin >= rightMin) return "similar";
  if (side === "right" && rightMin >= leftMin) return "similar";
  return side;
}

/** 横向きの成分の強さ（0〜1）。真横で1、正面・真後ろ寄りほど小さい */
export function sideWeight(bearingDeg: number, sun: SunLike): number {
  if (vehicleSunSide(bearingDeg, sun) === "none") return 0;
  return Math.abs(Math.sin((sunAngleFromHeading(bearingDeg, sun) * Math.PI) / 180));
}
