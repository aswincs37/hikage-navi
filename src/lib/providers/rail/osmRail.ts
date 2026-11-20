import type { LegMode, LonLat, Place, RouteAlternative, RouteLeg } from "@/lib/domain/types";
import { addSeconds, toTokyoIso } from "@/lib/time/tokyo";
import type { TransitRoutingProvider } from "../types";
import { CLASS_SPEED_MPS, loadRailNetwork, metres, STOP_SEC, type RailNetwork } from "./network";

/**
 * OpenStreetMap の線路に沿った電車の経路（推定）。時刻表は使わない。
 *
 * - 出発地・目的地の近くの駅（1.5km 以内、無ければ 3km 以内）から、線路網上で所要時間が最短の経路を探す
 * - 所要時間は「線路の種類ごとの走行速度」＋「途中の駅ごとの停車時間（駅名ごとに1回）」で推定し、
 *   最初の待ち時間と乗り換え時間を一定の値で加える（実際の代表的な所要時間との比較: tests/rail-benchmarks.test.ts）
 * - 新幹線を短い区間で選びすぎないための値は、経路を選ぶときだけ使い、表示する所要時間には含めない
 * - 座席の左右の判定に必要なのは「線路の向き」と「おおよその通過時刻」なので、時刻表が無くても推定できる
 * 実際の列車の運行（どの列車が走っているか、直通運転の有無、正確な発着時刻）は反映しない。
 */

/** 歩く速さ（m/s）と、直線距離に対する実際の道のりの比 */
const WALK_MPS = 1.3;
const WALK_DETOUR = 1.25;
/** 最初の列車を待つ時間の目安（秒） */
const FIRST_WAIT_SEC = 180;
/** これより短い乗車は乗り換えの移動とみなし、区間として表示しない（m） */
const MIN_RIDE_M = 400;
/** 駅まで歩くとみなす距離（m）。これ以下なら徒歩区間を作らない */
const MIN_WALK_M = 60;
const MAX_SPEED = Math.max(...CLASS_SPEED_MPS);

export class OsmRailTransitProvider implements TransitRoutingProvider {
  readonly id = "osm-rail";
  readonly modes = ["train"] as const;
  constructor(private readonly networkOrFile: string | RailNetwork) {}

  private network(): RailNetwork {
    return typeof this.networkOrFile === "string" ? loadRailNetwork(this.networkOrFile) : this.networkOrFile;
  }

  async plan(origin: Place, destination: Place, departure: Date): Promise<RouteAlternative[]> {
    const r = planRail(this.network(), origin, destination, departure);
    return r ? [r] : [];
  }
}

function nearStations(net: RailNetwork, p: LonLat) {
  const near = net.stationsNear(p, 1500);
  return (near.length > 0 ? near : net.stationsNear(p, 3000)).slice(0, 8);
}

const walkSec = (distM: number) => (distM * WALK_DETOUR) / WALK_MPS;

export function planRail(net: RailNetwork, origin: Place, destination: Place, departure: Date): RouteAlternative | null {
  const o: LonLat = [origin.lon, origin.lat];
  const d: LonLat = [destination.lon, destination.lat];
  const from = nearStations(net, o);
  const to = nearStations(net, d);
  if (from.length === 0 || to.length === 0) return null;

  // A*（推定値 = 直線距離 ÷ 最高速度。所要時間を過大に見積もらないので最短が保証される）
  const N = net.nodeLonLat.length;
  const T = N; // 仮想の目的地ノード
  // dist: 経路を選ぶための値（新幹線の選択ペナルティを含む）、time: 実際の経過時間
  const dist = new Float64Array(N + 1).fill(Infinity);
  const time = new Float64Array(N + 1).fill(Infinity);
  // 最後に停車した駅（駅名の番号）と、その点に着いたときに足した停車時間
  const lastStop = new Int32Array(N + 1).fill(-1);
  const stopAt = new Float64Array(N + 1);
  const prevPiece = new Int32Array(N + 1).fill(-1);
  const prevNode = new Int32Array(N + 1).fill(-1);
  const goal = new Map<number, number>();
  for (const s of to) {
    const n = net.stationNode[s.station]!;
    goal.set(n, Math.min(goal.get(n) ?? Infinity, s.distM <= MIN_WALK_M ? 0 : walkSec(s.distM)));
  }
  const h = (n: number) => (n === T ? 0 : metres(net.nodeLonLat[n]!, d) / MAX_SPEED);
  const heap = new MinHeap();
  for (const s of from) {
    const n = net.stationNode[s.station]!;
    const c = (s.distM <= MIN_WALK_M ? 0 : walkSec(s.distM)) + FIRST_WAIT_SEC;
    if (c < dist[n]!) {
      dist[n] = c;
      time[n] = c;
      heap.push(n, c + h(n));
    }
  }
  const closed = new Uint8Array(N + 1);
  while (heap.size > 0) {
    const u = heap.pop();
    if (closed[u]) continue;
    closed[u] = 1;
    if (u === T) break;
    const g = goal.get(u);
    if (g !== undefined && dist[u]! + g < dist[T]!) {
      dist[T] = dist[u]! + g;
      time[T] = time[u]! + g;
      prevNode[T] = u;
      heap.push(T, dist[T]!);
    }
    for (const pi of net.adj[u]!) {
      const p = net.pieces[pi]!;
      const v = p.u === u ? p.v : p.u;
      if (closed[v]) continue;
      // 停車: 乗車駅の次から、新しい駅名の駅に着くたびに1回
      let stop = 0;
      let ls = lastStop[u]!;
      if (p.kind === 0) {
        const st = net.tpStation.get(v);
        if (st !== undefined && net.stationNameId[st] !== ls) {
          ls = net.stationNameId[st]!;
          stop = STOP_SEC[net.edgeCls[p.edge] as 0 | 1 | 2 | 3] ?? 40;
        }
      } else {
        // 乗車（駅 → 線路点）: 乗車駅では停車時間を数えない。降車（線路点 → 駅）: 記録を消す
        const st = net.nodeStation.get(u);
        ls = st !== undefined ? net.stationNameId[st]! : -1;
      }
      const c = dist[u]! + p.costSec + stop + p.penaltySec;
      if (c < dist[v]!) {
        dist[v] = c;
        time[v] = time[u]! + p.costSec + stop;
        lastStop[v] = ls;
        stopAt[v] = stop;
        prevPiece[v] = pi;
        prevNode[v] = u;
        heap.push(v, c + h(v));
      }
    }
  }
  if (!Number.isFinite(dist[T]!)) return null;

  // 経路を復元: 目的地側の駅から出発側の駅までたどる
  const endStationNode = prevNode[T]!;
  const steps: { from: number; to: number; piece: number }[] = [];
  for (let v = endStationNode; prevPiece[v]! >= 0; v = prevNode[v]!) steps.push({ from: prevNode[v]!, to: v, piece: prevPiece[v]! });
  steps.reverse();
  const startNode = steps.length ? steps[0]!.from : endStationNode;

  // 乗車区間に分ける（乗車・降車の辺で区切る）
  interface Ride { boardNode: number; alightNode: number; steps: typeof steps; startSec: number; durationSec: number; distM: number }
  const rides: Ride[] = [];
  let cur: Ride | null = null;
  let boardNode = startNode;
  for (const s of steps) {
    const p = net.pieces[s.piece]!;
    if (p.kind === 1) {
      if (net.nodeStation.has(s.from)) {
        boardNode = s.from; // 乗車
        cur = null;
      } else if (cur) {
        cur.alightNode = s.to; // 降車
        cur = null;
      }
      continue;
    }
    if (!cur) {
      cur = { boardNode, alightNode: -1, steps: [], startSec: time[s.from]!, durationSec: 0, distM: 0 };
      rides.push(cur);
    }
    cur.steps.push(s);
    cur.durationSec += p.costSec + stopAt[s.to]!;
    cur.distM += p.to - p.from;
  }
  const kept = rides.filter((r) => r.distM >= MIN_RIDE_M && r.alightNode >= 0);
  if (kept.length === 0) return null;

  const startStationIndex = net.nodeStation.get(kept[0]!.boardNode)!;
  const endStationIndex = net.nodeStation.get(kept[kept.length - 1]!.alightNode)!;
  const sFrom = net.stations[startStationIndex]!;
  const sTo = net.stations[endStationIndex]!;
  const legs: RouteLeg[] = [];
  const at = (sec: number) => toTokyoIso(addSeconds(departure, sec));

  const walkLeg = (a: LonLat, b: LonLat, startSec: number, fromName?: string, toName?: string): RouteLeg | null => {
    const m = metres(a, b);
    if (m <= MIN_WALK_M) return null;
    const dur = walkSec(m);
    return {
      mode: "walk",
      outdoor: true,
      startTime: at(startSec),
      endTime: at(startSec + dur),
      durationSec: Math.round(dur),
      distanceM: Math.round(m * WALK_DETOUR),
      geometry: [a, b],
      vertexOffsetsSec: [0, Math.round(dur)],
      fromName,
      toName,
    };
  };

  const first = walkLeg(o, [sFrom.lon, sFrom.lat], 0, origin.label, sFrom.name);
  if (first) legs.push(first);

  for (const r of kept) {
    const geometry: LonLat[] = [];
    const offsets: number[] = [];
    let t = 0;
    const lenByName = new Map<string, number>();
    let subwayM = 0;
    for (const s of r.steps) {
      const p = net.pieces[s.piece]!;
      const stepSec = p.costSec + stopAt[s.to]!;
      let g = net.slice(p.edge, p.from, p.to);
      if (s.from !== p.u) g = g.slice().reverse();
      const cum = [0];
      for (let k = 1; k < g.length; k++) cum.push(cum[k - 1]! + metres(g[k - 1]!, g[k]!));
      const total = cum[cum.length - 1]! || 1;
      g.forEach((pt, k) => {
        if (k === 0 && geometry.length > 0) return;
        geometry.push(pt);
        offsets.push(t + (stepSec * cum[k]!) / total);
      });
      t += stepSec;
      const len = p.to - p.from;
      const name = net.edgeName[p.edge]!;
      if (name) lenByName.set(name, (lenByName.get(name) ?? 0) + len);
      if (net.edgeCls[p.edge] === 2) subwayM += len;
    }
    const routeName = [...lenByName.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mode: LegMode = subwayM > r.distM / 2 ? "subway" : "rail";
    legs.push({
      mode,
      outdoor: false,
      startTime: at(r.startSec),
      endTime: at(r.startSec + r.durationSec),
      durationSec: Math.round(r.durationSec),
      distanceM: Math.round(r.distM),
      geometry,
      vertexOffsetsSec: offsets.map((x) => Math.round(x * 10) / 10),
      fromName: net.stations[net.nodeStation.get(r.boardNode)!]!.name,
      toName: net.stations[net.nodeStation.get(r.alightNode)!]!.name,
      routeName,
    });
  }

  const lastRide = kept[kept.length - 1]!;
  const lastEnd = lastRide.startSec + lastRide.durationSec + BOARD_DELAY_FOR_EXIT;
  const last = walkLeg([sTo.lon, sTo.lat], d, lastEnd, sTo.name, destination.label);
  if (last) legs.push(last);

  const totalSec = Math.round(last ? lastEnd + last.durationSec : lastEnd);
  const walking = legs.filter((l) => l.mode === "walk").reduce((s, l) => s + l.durationSec, 0);
  const riding = legs.filter((l) => l.mode !== "walk").reduce((s, l) => s + l.durationSec, 0);
  return {
    id: "train-0",
    mode: "train",
    legs,
    startTime: at(0),
    endTime: at(totalSec),
    durationSec: totalSec,
    distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
    walkingSec: walking,
    transfers: kept.length - 1,
    waitingSec: Math.max(0, totalSec - walking - riding),
    source: {
      provider: "osm-rail",
      kind: "estimate",
      retrievedAt: new Date().toISOString(),
      attribution: "© OpenStreetMap contributors (ODbL)",
      note: "estimated_from_track_geometry_no_timetable",
    },
  };
}

/** 降車してから駅を出るまでの時間（秒） */
const BOARD_DELAY_FOR_EXIT = 60;

/** 二分ヒープ（優先度付きキュー） */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!;
      keys[i] = keys[p]!;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length > 0) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastKey) break;
        ids[i] = ids[c]!;
        keys[i] = keys[c]!;
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
