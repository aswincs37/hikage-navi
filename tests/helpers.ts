import type { LegMode, LonLat, RouteAlternative, RouteLeg } from "@/lib/domain/types";
import { haversineM, lineLengthM, proportionalOffsets } from "@/lib/geo/geometry";
import { addSeconds, parseTokyoLocal, toTokyoIso } from "@/lib/time/tokyo";

/** テスト用の合成経路（実在の経路・時刻表ではない） */
export function line(from: LonLat, bearing: "north" | "south" | "east" | "west", meters: number, steps = 10): LonLat[] {
  const dLat = meters / 111_195;
  const dLon = meters / (111_195 * Math.cos((from[1] * Math.PI) / 180));
  const [dx, dy] = ({ north: [0, dLat], south: [0, -dLat], east: [dLon, 0], west: [-dLon, 0] } as const)[bearing];
  return Array.from({ length: steps + 1 }, (_, i) => [from[0] + (dx * i) / steps, from[1] + (dy * i) / steps] as LonLat);
}

export function leg(mode: LegMode, geometry: LonLat[], start: Date, durationSec: number): RouteLeg {
  return {
    mode,
    outdoor: mode === "walk" || mode === "cycle",
    startTime: toTokyoIso(start),
    endTime: toTokyoIso(addSeconds(start, durationSec)),
    durationSec,
    distanceM: lineLengthM(geometry),
    geometry,
    vertexOffsetsSec: proportionalOffsets(geometry, durationSec),
  };
}

export function route(id: string, legs: RouteLeg[], extra: Partial<RouteAlternative> = {}): RouteAlternative {
  const start = new Date(legs[0]!.startTime);
  const end = new Date(legs[legs.length - 1]!.endTime);
  return {
    id,
    // 検索できる移動手段は道路と電車のみ。徒歩だけの合成経路も、電車の乗り換え徒歩区間として "train" 扱いにする
    mode: legs.some((l) => l.mode === "car") ? "car" : "train",
    legs,
    startTime: toTokyoIso(start),
    endTime: toTokyoIso(end),
    durationSec: (end.getTime() - start.getTime()) / 1000,
    distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
    walkingSec: legs.filter((l) => l.mode === "walk").reduce((s, l) => s + l.durationSec, 0),
    source: { provider: "test-fixture", kind: "provider_route" },
    ...extra,
  };
}

export const t = (s: string) => parseTokyoLocal(s)!;
export { haversineM };
