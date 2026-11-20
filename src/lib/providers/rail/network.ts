import fs from "node:fs";
import zlib from "node:zlib";
import type { LonLat } from "@/lib/domain/types";

/**
 * 鉄道ネットワーク（OpenStreetMap の線路と駅。scripts/build-rail-network.mjs で作成）を読み込み、
 * 経路探索用のグラフを作る。
 *
 * グラフのノード: 線路の分岐点・端点 / 駅に最も近い線路上の点（線路点） / 駅
 * グラフの辺:   線路の区間（両方向、走る時間 = 距離 ÷ 線路種別ごとの走行速度。駅での停車時間は経路探索で足す）
 *               駅 ↔ 線路点（乗車・降車。乗り換えの時間をここで表す）
 */

/**
 * 線路種別ごとの走行速度（m/s）。0 新幹線・高速線, 1 在来線, 2 地下鉄, 3 ライトレール等。
 * 実際の代表的な所要時間（tests/rail-benchmarks.test.ts）に合うよう調整した値。
 * 新幹線は通過する駅が多く途中の停車を数えないため、停車を含めた平均（約210km/h）にしている。
 */
export const CLASS_SPEED_MPS = [59, 33, 14, 10] as const;
/**
 * 駅1つあたりの停車と加速・減速の時間（秒）。乗車駅の次の駅から降車駅まで、駅名ごとに1回数える
 * （大きな駅は線路が何本にも分かれているため、線路点ごとではなく駅名で数える）。
 * 都市部の駅の多い区間は遅く、駅の少ない区間は速くなる。新幹線は 0（速度に含める）。
 */
export const STOP_SEC = [0, 35, 45, 35] as const;
/** 乗車・降車にかかる時間（秒。列車を待つ時間を含む）。乗り換え1回 = 降車 + 乗車 */
export const BOARD_SEC = 150;
/** 新幹線・高速線の乗車・降車で増える実際の時間（秒。改札・長いホームの移動）。乗車と降車で半分ずつ */
export const HIGH_SPEED_BOARD_EXTRA_SEC = 240;
/**
 * 新幹線・高速線を選ぶときだけ足す値（秒）。表示する所要時間には含めない。
 * 本数が少なく料金も高いため、数分しか速くならない短い区間で新幹線を選ばないようにする。
 */
export const HIGH_SPEED_CHOICE_PENALTY_SEC = 900;
/**
 * 駅を線路に結び付ける範囲（m）。駅の点（ホーム付近）から近い線路だけを、その駅に停まる線路とみなす。
 * 新幹線などの高速線は通過する駅が多いため、ごく近い（駅の点がほぼ線路上にある）場合だけにする。
 */
const ATTACH_RADIUS_M = [60, 150, 150, 150] as const;
const MAX_ATTACH_RADIUS_M = 150;
/** 同じ名前の駅（路線ごとに別の点がある大きな駅など）をこの距離以内なら乗り換えでつなぐ（m） */
const SAME_NAME_TRANSFER_M = 700;
/** 同じ名前の別の点への乗り換えで歩く時間（秒） */
const SAME_NAME_WALK_SEC = 300;
const CELL_DEG = 0.005;

interface RawNetwork {
  v: number;
  generated: string;
  attribution: string;
  nodes: number[];
  edges: { a: number[]; b: number[]; len: number[]; cls: number[]; name: number[]; tunnel: number[]; geom: number[][]; op?: number[] };
  names: string[];
  /** [名前, 英語名, 経度×1e5, 緯度×1e5, 地下鉄駅なら1, 運営会社（; 区切り、無ければ空）] */
  stations: [string, string, number, number, number, string?][];
}

export interface Station {
  name: string;
  nameEn: string;
  lon: number;
  lat: number;
}

/** グラフの辺。kind 0 = 線路、1 = 乗車・降車 */
export interface Piece {
  u: number;
  v: number;
  kind: 0 | 1;
  /** 線路: 元の区間番号と、区間の始点からの距離（m）。from < to */
  edge: number;
  from: number;
  to: number;
  /** 実際にかかる時間（秒） */
  costSec: number;
  /** 経路を選ぶときだけ足す値（秒）。所要時間には含めない */
  penaltySec: number;
}

export class RailNetwork {
  readonly stations: Station[];
  readonly edgeGeom: LonLat[][];
  readonly edgeCum: Float64Array[];
  readonly edgeLen: number[];
  readonly edgeCls: number[];
  readonly edgeName: string[];
  readonly pieces: Piece[] = [];
  /** ノードごとの辺（pieces の番号） */
  readonly adj: number[][] = [];
  readonly nodeLonLat: LonLat[] = [];
  /** 駅番号 → グラフのノード番号 */
  readonly stationNode: number[] = [];
  readonly nodeStation: Map<number, number> = new Map();
  /** 線路点（駅を線路に結び付けた点）→ 駅番号 */
  readonly tpStation: Map<number, number> = new Map();
  /** 駅番号 → 駅名の番号（同じ名前の駅は同じ番号。停車を駅名ごとに1回だけ数えるため） */
  readonly stationNameId: Int32Array;
  private readonly stationGrid = new Map<string, number[]>();
  readonly generated: string;

  constructor(raw: RawNetwork) {
    this.generated = raw.generated;
    const nodeCount = raw.nodes.length / 2;
    for (let i = 0; i < nodeCount; i++) this.addNode([raw.nodes[2 * i]! * 1e-5, raw.nodes[2 * i + 1]! * 1e-5]);

    const E = raw.edges.a.length;
    this.edgeGeom = new Array(E);
    this.edgeCum = new Array(E);
    this.edgeLen = raw.edges.len;
    this.edgeCls = raw.edges.cls;
    this.edgeName = raw.edges.name.map((i) => (i >= 0 ? raw.names[i]! : ""));
    for (let e = 0; e < E; e++) {
      const a = this.nodeLonLat[raw.edges.a[e]!]!;
      const b = this.nodeLonLat[raw.edges.b[e]!]!;
      const g: LonLat[] = [a];
      let x = Math.round(a[0] * 1e5);
      let y = Math.round(a[1] * 1e5);
      const enc = raw.edges.geom[e]!;
      for (let k = 0; k < enc.length; k += 2) {
        x += enc[k]!;
        y += enc[k + 1]!;
        g.push([x * 1e-5, y * 1e-5]);
      }
      g.push(b);
      this.edgeGeom[e] = g;
      const cum = new Float64Array(g.length);
      for (let k = 1; k < g.length; k++) cum[k] = cum[k - 1]! + metres(g[k - 1]!, g[k]!);
      // 間引いた形状の長さを、元の長さ（len）に合わせて伸縮する
      const scale = cum[g.length - 1]! > 0 ? raw.edges.len[e]! / cum[g.length - 1]! : 1;
      for (let k = 1; k < g.length; k++) cum[k] = cum[k]! * scale;
      this.edgeCum[e] = cum;
    }

    this.stations = raw.stations.map(([name, nameEn, x, y]) => ({ name, nameEn, lon: x * 1e-5, lat: y * 1e-5 }));
    const nameIds = new Map<string, number>();
    this.stationNameId = Int32Array.from(this.stations, (st) => {
      let id = nameIds.get(st.name);
      if (id === undefined) nameIds.set(st.name, (id = nameIds.size));
      return id;
    });
    this.stations.forEach((s, i) => {
      const key = cellKey(s.lon, s.lat);
      const list = this.stationGrid.get(key);
      if (list) list.push(i);
      else this.stationGrid.set(key, [i]);
    });

    // 駅を近くの線路に結び付け、線路の区間を駅の位置で分割する
    const edgeGrid = new Map<string, number[]>();
    for (let e = 0; e < E; e++) {
      const seen = new Set<string>();
      const g = this.edgeGeom[e]!;
      for (let k = 1; k < g.length; k++) {
        for (const key of segmentCells(g[k - 1]!, g[k]!)) {
          if (seen.has(key)) continue;
          seen.add(key);
          const list = edgeGrid.get(key);
          if (list) list.push(e);
          else edgeGrid.set(key, [e]);
        }
      }
    }
    const attach: { along: number; station: number }[][] = Array.from({ length: E }, () => []);
    // 運営会社: 駅と線路の両方に運営会社があり、近くに同じ会社の線路があるときは、その会社の線路だけに結び付ける
    // （例: 京急の北品川駅のすぐ横を JR の線路が通っていても、JR はその駅に停まらない）
    const edgeOp = (raw.edges.op ?? []).map((i) => (i >= 0 ? operatorKey(raw.names[i]!) : ""));
    this.stations.forEach((s, si) => {
      const stationOps = (raw.stations[si]![5] ?? "").split(/[;；]/).map(operatorKey).filter(Boolean);
      const best = new Map<number, { d: number; along: number }>();
      for (const key of cellsAround(s.lon, s.lat, MAX_ATTACH_RADIUS_M)) {
        for (const e of edgeGrid.get(key) ?? []) {
          const p = this.project(e, [s.lon, s.lat]);
          if (p.d > (ATTACH_RADIUS_M[this.edgeCls[e] as 0 | 1 | 2 | 3] ?? MAX_ATTACH_RADIUS_M)) continue;
          const prev = best.get(e);
          if (!prev || p.d < prev.d) best.set(e, p);
        }
      }
      let chosen = [...best.entries()];
      if (stationOps.length > 0) {
        const same = chosen.filter(([e]) => edgeOp[e] && stationOps.includes(edgeOp[e]!));
        if (same.length > 0) chosen = same;
      }
      for (const [e, p] of chosen) attach[e]!.push({ along: p.along, station: si });
    });

    this.stations.forEach((s, si) => {
      const n = this.addNode([s.lon, s.lat]);
      this.stationNode[si] = n;
      this.nodeStation.set(n, si);
    });

    for (let e = 0; e < E; e++) {
      const cls = this.edgeCls[e] as 0 | 1 | 2 | 3;
      const speed = CLASS_SPEED_MPS[cls] ?? 15;
      const highSpeed = cls === 0;
      const points = attach[e]!.sort((p, q) => p.along - q.along);
      let prevNode = raw.edges.a[e]!;
      let prevAlong = 0;
      for (const p of points) {
        const tp = this.addNode(this.pointAt(e, p.along));
        this.tpStation.set(tp, p.station);
        // 走る時間だけ。途中の駅での停車時間は、経路探索で駅（名前）ごとに1回だけ足す
        this.addPiece({ u: prevNode, v: tp, kind: 0, edge: e, from: prevAlong, to: p.along, costSec: (p.along - prevAlong) / speed, penaltySec: 0 });
        this.addPiece({
          u: this.stationNode[p.station]!,
          v: tp,
          kind: 1,
          edge: -1,
          from: 0,
          to: 0,
          costSec: BOARD_SEC + (highSpeed ? HIGH_SPEED_BOARD_EXTRA_SEC / 2 : 0),
          penaltySec: highSpeed ? HIGH_SPEED_CHOICE_PENALTY_SEC / 2 : 0,
        });
        prevNode = tp;
        prevAlong = p.along;
      }
      const len = this.edgeLen[e]!;
      this.addPiece({ u: prevNode, v: raw.edges.b[e]!, kind: 0, edge: e, from: prevAlong, to: len, costSec: (len - prevAlong) / speed, penaltySec: 0 });
    }

    // 同じ名前で離れた位置にある駅（例: 東京駅の在来線と京葉線）は歩いて乗り換えられるようにする
    const byName = new Map<string, number[]>();
    this.stations.forEach((s, i) => {
      const list = byName.get(s.name);
      if (list) list.push(i);
      else byName.set(s.name, [i]);
    });
    for (const list of byName.values()) {
      for (let x = 0; x < list.length; x++)
        for (let y = x + 1; y < list.length; y++) {
          const a = this.stations[list[x]!]!, b = this.stations[list[y]!]!;
          if (metres([a.lon, a.lat], [b.lon, b.lat]) > SAME_NAME_TRANSFER_M) continue;
          this.addPiece({ u: this.stationNode[list[x]!]!, v: this.stationNode[list[y]!]!, kind: 1, edge: -1, from: 0, to: 0, costSec: SAME_NAME_WALK_SEC, penaltySec: 0 });
        }
    }
  }

  private addNode(p: LonLat): number {
    this.nodeLonLat.push(p);
    this.adj.push([]);
    return this.nodeLonLat.length - 1;
  }

  private addPiece(p: Piece) {
    const i = this.pieces.length;
    this.pieces.push(p);
    this.adj[p.u]!.push(i);
    this.adj[p.v]!.push(i);
  }

  /** 区間 e 上で点 p に最も近い位置（始点からの距離 along、点からの距離 d） */
  project(e: number, p: LonLat): { d: number; along: number } {
    const g = this.edgeGeom[e]!;
    const cum = this.edgeCum[e]!;
    const cos = Math.cos((p[1] * Math.PI) / 180);
    let best = { d: Infinity, along: 0 };
    for (let k = 1; k < g.length; k++) {
      const ax = (g[k - 1]![0] - p[0]) * cos, ay = g[k - 1]![1] - p[1];
      const bx = (g[k]![0] - p[0]) * cos, by = g[k]![1] - p[1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy) * 111_320;
      if (d < best.d) best = { d, along: cum[k - 1]! + t * (cum[k]! - cum[k - 1]!) };
    }
    return best;
  }

  /** 区間 e の始点から along（m）の位置 */
  pointAt(e: number, along: number): LonLat {
    const g = this.edgeGeom[e]!;
    const cum = this.edgeCum[e]!;
    for (let k = 1; k < g.length; k++) {
      if (along <= cum[k]! || k === g.length - 1) {
        const span = cum[k]! - cum[k - 1]!;
        const t = span > 0 ? Math.max(0, Math.min(1, (along - cum[k - 1]!) / span)) : 0;
        return [g[k - 1]![0] + t * (g[k]![0] - g[k - 1]![0]), g[k - 1]![1] + t * (g[k]![1] - g[k - 1]![1])];
      }
    }
    return g[g.length - 1]!;
  }

  /** 区間 e の from〜to（m）の形状 */
  slice(e: number, from: number, to: number): LonLat[] {
    const g = this.edgeGeom[e]!;
    const cum = this.edgeCum[e]!;
    const out: LonLat[] = [this.pointAt(e, from)];
    for (let k = 1; k < g.length - 1; k++) if (cum[k]! > from && cum[k]! < to) out.push(g[k]!);
    out.push(this.pointAt(e, to));
    return out;
  }

  /** 地点から radiusM 以内の駅（近い順） */
  stationsNear(p: LonLat, radiusM: number): { station: number; distM: number }[] {
    const out: { station: number; distM: number }[] = [];
    for (const key of cellsAround(p[0], p[1], radiusM)) {
      for (const si of this.stationGrid.get(key) ?? []) {
        const s = this.stations[si]!;
        const d = metres(p, [s.lon, s.lat]);
        if (d <= radiusM && this.adj[this.stationNode[si]!]!.length > 0) out.push({ station: si, distM: d });
      }
    }
    return out.sort((a, b) => a.distM - b.distM);
  }
}

/**
 * 運営会社名を比べるための正規化。JR 各社は会社をまたいで同じ駅に停まるため、まとめて "JR" とする。
 * 正式名と略称の主な揺れ（東京地下鉄 / 東京メトロ など）もそろえる。
 */
export function operatorKey(op: string): string {
  const o = op.trim().replace(/\s+/g, "");
  if (!o) return "";
  if (/旅客鉄道|^JR|^ＪＲ/i.test(o)) return "JR";
  const aliases: [RegExp, string][] = [
    [/^(東京地下鉄|東京メトロ|TokyoMetro)/i, "東京地下鉄"],
    [/^(東京急行電鉄|東急電鉄|東急)/, "東急"],
    [/^(大阪市高速電気軌道|OsakaMetro|大阪メトロ)/i, "大阪市高速電気軌道"],
    [/^(東京都交通局|都営)/, "東京都交通局"],
  ];
  for (const [re, key] of aliases) if (re.test(o)) return key;
  return o;
}

export function metres(a: LonLat, b: LonLat): number {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * cos, b[1] - a[1]) * 111_320;
}

function cellKey(lon: number, lat: number) {
  return `${Math.floor(lon / CELL_DEG)}:${Math.floor(lat / CELL_DEG)}`;
}

function* cellsAround(lon: number, lat: number, radiusM: number) {
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  for (let x = Math.floor((lon - dLon) / CELL_DEG); x <= Math.floor((lon + dLon) / CELL_DEG); x++)
    for (let y = Math.floor((lat - dLat) / CELL_DEG); y <= Math.floor((lat + dLat) / CELL_DEG); y++) yield `${x}:${y}`;
}

function* segmentCells(a: LonLat, b: LonLat) {
  for (let x = Math.floor(Math.min(a[0], b[0]) / CELL_DEG); x <= Math.floor(Math.max(a[0], b[0]) / CELL_DEG); x++)
    for (let y = Math.floor(Math.min(a[1], b[1]) / CELL_DEG); y <= Math.floor(Math.max(a[1], b[1]) / CELL_DEG); y++) yield `${x}:${y}`;
}

const loaded = new Map<string, { mtimeMs: number; network: RailNetwork }>();

/** ネットワークファイルを読み込む（メモリに保持し、ファイルが作り直されたときだけ読み込み直す） */
export function loadRailNetwork(file: string): RailNetwork {
  const mtimeMs = fs.statSync(file).mtimeMs;
  const hit = loaded.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.network;
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as RawNetwork;
  const network = new RailNetwork(raw);
  loaded.set(file, { mtimeMs, network });
  return network;
}

export function railNetworkFromRaw(raw: RawNetwork): RailNetwork {
  return new RailNetwork(raw);
}
export type { RawNetwork };
