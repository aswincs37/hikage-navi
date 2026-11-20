import type { LonLat, LegMode } from "@/lib/domain/types";
import { toLocalXY } from "@/lib/geo/geometry";
import type { JourneyRequest } from "@/lib/validation/schemas";
import { fetchRoutes } from "./search";

/**
 * 検索前（ホーム画面）の地図に描く「実際の道のり」。
 * 日差し・天気の計算はせず、経路の形だけを軽く返す（低速回線でも数KB）。
 */

export interface PreviewLeg {
  mode: LegMode;
  geometry: LonLat[];
}

export interface JourneyPreview {
  legs: PreviewLeg[];
  distanceM: number;
  durationSec: number;
}

/** 1経路あたりの点数の上限（地図表示には十分） */
const MAX_POINTS = 600;

/** Douglas–Peucker 法で線を間引く（許容誤差はメートル） */
export function simplifyLine(line: LonLat[], toleranceM: number): LonLat[] {
  if (line.length <= 2) return line;
  const origin = line[0]!;
  const xy = line.map((p) => toLocalXY(origin, p));
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a]!;
    const [bx, by] = xy[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return line.filter((_, i) => keep[i] === 1);
}

const round5 = (p: LonLat): LonLat => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

/** 経路の形を間引いて返す。経路が無ければ null */
export async function previewJourney(req: JourneyRequest, providers: Parameters<typeof fetchRoutes>[1]): Promise<JourneyPreview | null> {
  const fetched = await fetchRoutes(req, providers);
  // 経路サーバーの一時的な失敗は「経路なし」と区別する（「経路なし」として覚えてしまわないように）
  if (fetched.status === "provider_error") throw new Error(`routing failed: ${fetched.notice.provider}`);
  const route = fetched.routes[0];
  if (!route) return null;
  const totalPoints = route.legs.reduce((n, l) => n + l.geometry.length, 0);
  // 長い経路ほど粗く（東京〜仙台で 約150m、市内で 約5m）
  let tolerance = Math.max(5, route.distanceM / 2500);
  let legs: PreviewLeg[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    legs = route.legs
      .filter((l) => l.geometry.length >= 2)
      .map((l) => ({ mode: l.mode, geometry: simplifyLine(l.geometry, tolerance).map(round5) }));
    const n = legs.reduce((s, l) => s + l.geometry.length, 0);
    if (n <= MAX_POINTS || totalPoints <= MAX_POINTS) break;
    tolerance *= 2;
  }
  return { legs, distanceM: Math.round(route.distanceM), durationSec: Math.round(route.durationSec) };
}
