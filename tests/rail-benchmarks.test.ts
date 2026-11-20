import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadRailNetwork } from "@/lib/providers/rail/network";
import { planRail } from "@/lib/providers/rail/osmRail";

/**
 * 電車の所要時間の推定を、実際の代表的な所要時間（乗換案内アプリで調べた、
 * 最初の列車の発車〜最後の列車の到着。日中の速い列車）と比べる。
 * 推定は時刻表を使わないため、±25% 以内を目標とする。
 */
const S = {
  tokyo: [35.6812, 139.7671],
  shinOsaka: [34.7335, 135.5003],
  nagoya: [35.1709, 136.8815],
  kyoto: [34.9858, 135.7588],
  sendai: [38.2601, 140.8824],
  yokohama: [35.4658, 139.6223],
  shinjuku: [35.6896, 139.7006],
  osaka: [34.7025, 135.4959],
  shibuya: [35.658, 139.7016],
  ginza: [35.6717, 139.765],
  hakata: [33.5902, 130.4207],
  kagoshimaChuo: [31.5838, 130.5414],
  ueno: [35.7138, 139.7773],
  omiya: [35.9064, 139.6238],
  shinagawa: [35.6285, 139.7387],
  sannomiya: [34.6946, 135.1953],
} as const;

/** [出発, 到着, 実際の代表的な乗車時間（分）, 説明] */
export const BENCHMARKS: [keyof typeof S, keyof typeof S, number, string][] = [
  ["tokyo", "shinOsaka", 147, "東海道新幹線 のぞみ"],
  ["nagoya", "kyoto", 35, "東海道新幹線 のぞみ"],
  ["tokyo", "sendai", 91, "東北新幹線 はやぶさ"],
  ["hakata", "kagoshimaChuo", 76, "九州新幹線 みずほ"],
  ["tokyo", "yokohama", 25, "JR東海道線"],
  ["shinjuku", "tokyo", 14, "JR中央線快速"],
  ["osaka", "kyoto", 29, "JR新快速"],
  ["osaka", "sannomiya", 21, "JR新快速"],
  ["ueno", "omiya", 25, "JR宇都宮線・高崎線"],
  ["shibuya", "ginza", 16, "東京メトロ銀座線"],
  ["tokyo", "shinagawa", 8, "JR東海道線・横須賀線（新幹線を使わない）"],
];

const FILE = path.join(process.cwd(), "data/rail/japan-rail.json.gz");
const DEPARTURE = new Date("2026-11-20T01:00:00Z"); // 10:00 JST

function rideMinutes(from: keyof typeof S, to: keyof typeof S) {
  const net = loadRailNetwork(FILE);
  const r = planRail(net, { lat: S[from][0], lon: S[from][1] }, { lat: S[to][0], lon: S[to][1] }, DEPARTURE);
  if (!r) return null;
  const rides = r.legs.filter((l) => l.mode !== "walk");
  const start = Date.parse(rides[0]!.startTime);
  const end = Date.parse(rides[rides.length - 1]!.endTime);
  return {
    rideMin: (end - start) / 60_000,
    totalMin: r.durationSec / 60,
    lines: rides.map((l) => `${l.routeName ?? l.mode}(${Math.round(l.durationSec / 60)})`).join(" → "),
  };
}

describe("rail travel time estimates vs real typical times", () => {
  it.each(BENCHMARKS)("%s → %s (real %i min, %s)", (from, to, realMin, label) => {
    const got = rideMinutes(from, to);
    expect(got, `no route for ${label}`).not.toBeNull();
    const ratio = got!.rideMin / realMin;
    console.log(`${from}→${to}: est ${got!.rideMin.toFixed(0)} min (real ${realMin}, x${ratio.toFixed(2)}) total ${got!.totalMin.toFixed(0)} | ${got!.lines}`);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });
});
