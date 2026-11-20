import { describe, expect, it } from "vitest";
import {
  angleDiffDeg,
  bearingDeg,
  decodePolyline,
  haversineM,
  mergePiecesByDuration,
  proportionalOffsets,
  rayPolygonDistance,
  samplePointsAlong,
  splitLine,
} from "@/lib/geo/geometry";
import type { LonLat } from "@/lib/domain/types";

describe("geometry", () => {
  it("東京駅〜大阪駅の距離は約403km", () => {
    const d = haversineM([139.7671, 35.6812], [135.4959, 34.7025]);
    expect(d / 1000).toBeGreaterThan(400);
    expect(d / 1000).toBeLessThan(406);
  });

  it("方位角: 東=90°、北=0°", () => {
    expect(bearingDeg([139, 35], [139.01, 35])).toBeCloseTo(90, 0);
    expect(bearingDeg([139, 35], [139, 35.01])).toBeCloseTo(0, 5);
    expect(bearingDeg([139, 35], [139, 34.99])).toBeCloseTo(180, 5);
  });

  it("角度差は -180〜180 で、時計回りが正", () => {
    expect(angleDiffDeg(90, 180)).toBe(90);
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(10, 350)).toBe(-20);
  });

  it("エンコード済みポリラインを復号する（Google の公式例）", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
    expect(() => decodePolyline("_p~iF~ps|")).toThrow();
  });

  it("区間分割で距離・所要時間が保存される", () => {
    const line: LonLat[] = [
      [139.7, 35.68],
      [139.705, 35.68],
      [139.705, 35.685],
    ];
    const offsets = proportionalOffsets(line, 600);
    const pieces = splitLine(line, offsets, 20);
    const dist = pieces.reduce((s, p) => s + p.distanceM, 0);
    const dur = pieces.reduce((s, p) => s + p.durationSec, 0);
    expect(dist).toBeCloseTo(haversineM(line[0]!, line[1]!) + haversineM(line[1]!, line[2]!), 3);
    expect(dur).toBeCloseTo(600, 6);
    expect(pieces.every((p) => p.distanceM <= 20.0001)).toBe(true);

    const merged = mergePiecesByDuration(pieces, 30);
    expect(merged.reduce((s, p) => s + p.durationSec, 0)).toBeCloseTo(600, 6);
    expect(merged.length).toBeLessThan(pieces.length);
  });

  it("頂点の経過時間が不一致なら分割しない", () => {
    expect(splitLine([[0, 0], [1, 1]], [0], 10)).toEqual([]);
  });

  it("等間隔の代表点に始点と終点が含まれる", () => {
    const line: LonLat[] = [
      [139.7, 35.68],
      [139.71, 35.68],
    ];
    const pts = samplePointsAlong(line, 100, 50);
    expect(pts[0]!.point).toEqual(line[0]);
    expect(pts[pts.length - 1]!.point[0]).toBeCloseTo(139.71, 6);
  });

  it("半直線と多角形の交差距離", () => {
    const square: [number, number][] = [
      [-5, 10],
      [5, 10],
      [5, 20],
      [-5, 20],
    ];
    expect(rayPolygonDistance([0, 1], square, 100)).toBeCloseTo(10, 6);
    expect(rayPolygonDistance([0, -1], square, 100)).toBeNull();
    expect(rayPolygonDistance([0, 1], square, 5)).toBeNull();
  });
});
