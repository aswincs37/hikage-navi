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

/** 横向きの成分の強さ（0〜1）。真横で1、正面・真後ろ寄りほど小さい */
export function sideWeight(bearingDeg: number, sun: SunLike): number {
  if (vehicleSunSide(bearingDeg, sun) === "none") return 0;
  return Math.abs(Math.sin((sunAngleFromHeading(bearingDeg, sun) * Math.PI) / 180));
}
