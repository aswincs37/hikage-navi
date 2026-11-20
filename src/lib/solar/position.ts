import { Body, Equator, Horizon, Observer } from "astronomy-engine";
import type { SolarPosition } from "@/lib/domain/types";
import { isValidLatLon } from "@/lib/geo/geometry";

/**
 * 太陽位置の計算。
 *
 * ライブラリ: astronomy-engine（MIT, Don Cross）。VSOP87 系の惑星理論に基づき、
 * 太陽の位置を 1 分角程度より良い精度で求める。
 *
 * - 方位角は北=0°、東=90° の時計回り。
 * - elevationDeg は大気差補正なしの「幾何学的高度」。地平線上か否かの判定にはこれを使う。
 * - apparentElevationDeg は標準大気での大気差補正（"normal"）を加えた見かけの高度。
 * - 観測者の標高は 0 m とする（地形による遮蔽はここでは扱わない）。
 */
export const SOLAR_LIBRARY = "astronomy-engine@2.1.19";

export class SolarInputError extends Error {}

export function solarPosition(lat: number, lon: number, date: Date): SolarPosition {
  if (!isValidLatLon(lat, lon)) throw new SolarInputError("invalid_coordinates");
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new SolarInputError("invalid_date");

  const observer = new Observer(lat, lon, 0);
  const eq = Equator(Body.Sun, date, observer, true, true);
  const geometric = Horizon(date, observer, eq.ra, eq.dec);
  const apparent = Horizon(date, observer, eq.ra, eq.dec, "normal");
  return {
    azimuthDeg: round(geometric.azimuth, 2),
    elevationDeg: round(geometric.altitude, 2),
    apparentElevationDeg: round(apparent.altitude, 2),
    aboveHorizon: geometric.altitude > 0,
  };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
