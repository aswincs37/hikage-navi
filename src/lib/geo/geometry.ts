import type { LonLat } from "@/lib/domain/types";

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function normaliseDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** 2点間の大円距離（m） */
export function haversineM(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** a から b への初期方位角（度、北=0、時計回り） */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const [lon1, lat1] = a.map(toRad) as [number, number];
  const [lon2, lat2] = b.map(toRad) as [number, number];
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  return normaliseDeg(toDeg(Math.atan2(y, x)));
}

/** 2つの方位角の差（-180〜180、b が a より時計回りなら正） */
export function angleDiffDeg(a: number, b: number): number {
  let d = normaliseDeg(b) - normaliseDeg(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function lineLengthM(line: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineM(line[i - 1]!, line[i]!);
  return total;
}

function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * 頂点ごとの経過秒数が無い場合、距離に比例して所要時間を配分する。
 */
export function proportionalOffsets(line: LonLat[], durationSec: number): number[] {
  const total = lineLengthM(line);
  const offsets = [0];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += haversineM(line[i - 1]!, line[i]!);
    offsets.push(total > 0 ? (acc / total) * durationSec : (i / Math.max(1, line.length - 1)) * durationSec);
  }
  return offsets;
}

export interface LinePiece {
  start: LonLat;
  end: LonLat;
  mid: LonLat;
  distanceM: number;
  /** 区間開始時点の経過秒数 */
  startOffsetSec: number;
  durationSec: number;
  bearingDeg: number;
}

/**
 * 線を最大 maxLengthM ごとの区間に分割する。経過時間は頂点ごとの値から線形補間する。
 * 長さ 0 の区間は除外する。
 */
export function splitLine(line: LonLat[], offsetsSec: number[], maxLengthM: number): LinePiece[] {
  if (line.length < 2 || offsetsSec.length !== line.length) return [];
  const pieces: LinePiece[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = haversineM(a, b);
    if (len < 0.01) continue;
    const t0 = offsetsSec[i - 1]!;
    const t1 = offsetsSec[i]!;
    const n = Math.max(1, Math.ceil(len / maxLengthM));
    const brg = bearingDeg(a, b);
    for (let k = 0; k < n; k++) {
      const s = lerp(a, b, k / n);
      const e = lerp(a, b, (k + 1) / n);
      pieces.push({
        start: s,
        end: e,
        mid: lerp(s, e, 0.5),
        distanceM: len / n,
        startOffsetSec: t0 + ((t1 - t0) * k) / n,
        durationSec: (t1 - t0) / n,
        bearingDeg: brg,
      });
    }
  }
  return pieces;
}

/**
 * 区間を一定の時間幅（秒）でまとめ直す。長い経路の計算量を抑えるため。
 * まとめた区間の方位は距離で重み付けしたベクトル平均。
 */
export function mergePiecesByDuration(pieces: LinePiece[], targetSec: number): LinePiece[] {
  const merged: LinePiece[] = [];
  let group: LinePiece[] = [];
  let groupSec = 0;
  const flush = () => {
    if (group.length === 0) return;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    let x = 0;
    let y = 0;
    let dist = 0;
    let dur = 0;
    for (const p of group) {
      x += Math.sin(toRad(p.bearingDeg)) * p.distanceM;
      y += Math.cos(toRad(p.bearingDeg)) * p.distanceM;
      dist += p.distanceM;
      dur += p.durationSec;
    }
    // 中点は、区間の距離の半分に当たる位置
    let half = dist / 2;
    let mid: LonLat = first.mid;
    for (const p of group) {
      if (half <= p.distanceM) {
        mid = lerp(p.start, p.end, p.distanceM > 0 ? half / p.distanceM : 0.5);
        break;
      }
      half -= p.distanceM;
    }
    merged.push({
      start: first.start,
      end: last.end,
      mid,
      distanceM: dist,
      startOffsetSec: first.startOffsetSec,
      durationSec: dur,
      bearingDeg: normaliseDeg(toDeg(Math.atan2(x, y))),
    });
    group = [];
    groupSec = 0;
  };
  for (const p of pieces) {
    group.push(p);
    groupSec += p.durationSec;
    if (groupSec >= targetSec) flush();
  }
  flush();
  return merged;
}

/** 経路上で、ほぼ等間隔の代表点を最大 maxPoints 個選ぶ（始点・終点を含む） */
export function samplePointsAlong(line: LonLat[], spacingM: number, maxPoints: number): { point: LonLat; distanceM: number }[] {
  if (line.length === 0) return [];
  const total = lineLengthM(line);
  const count = Math.min(maxPoints, Math.max(2, Math.floor(total / spacingM) + 1));
  if (line.length === 1 || total === 0) return [{ point: line[0]!, distanceM: 0 }];
  const targets = Array.from({ length: count }, (_, i) => (total * i) / (count - 1));
  const out: { point: LonLat; distanceM: number }[] = [];
  let acc = 0;
  let seg = 1;
  for (const target of targets) {
    while (seg < line.length - 1 && acc + haversineM(line[seg - 1]!, line[seg]!) < target) {
      acc += haversineM(line[seg - 1]!, line[seg]!);
      seg++;
    }
    const a = line[seg - 1]!;
    const b = line[seg]!;
    const len = haversineM(a, b);
    out.push({ point: lerp(a, b, len > 0 ? Math.min(1, (target - acc) / len) : 0), distanceM: target });
  }
  return out;
}

export function bbox(points: LonLat[]): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** 境界ボックスを m 単位で広げる */
export function expandBbox(b: [number, number, number, number], marginM: number): [number, number, number, number] {
  const latDeg = marginM / 111_320;
  const midLat = (b[1] + b[3]) / 2;
  const lonDeg = marginM / (111_320 * Math.max(0.01, Math.cos(toRad(midLat))));
  return [b[0] - lonDeg, b[1] - latDeg, b[2] + lonDeg, b[3] + latDeg];
}

// ---------------------------------------------------------------- 局所平面座標

/** 原点付近の正距円筒近似（数百m規模の影計算用）。x=東, y=北（m） */
export function toLocalXY(origin: LonLat, p: LonLat): [number, number] {
  const x = toRad(p[0] - origin[0]) * EARTH_RADIUS_M * Math.cos(toRad(origin[1]));
  const y = toRad(p[1] - origin[1]) * EARTH_RADIUS_M;
  return [x, y];
}

export function pointInPolygonXY(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * 原点から方向 (dx, dy)（単位ベクトル）に伸びる半直線が多角形の辺と最初に交わる距離。
 * 交わらなければ null。
 */
export function rayPolygonDistance(dir: [number, number], ring: [number, number][], maxDist: number): number | null {
  let best: number | null = null;
  const [dx, dy] = dir;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j]!;
    const [x2, y2] = ring[i]!;
    const ex = x2 - x1;
    const ey = y2 - y1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    // 原点 + t*dir = p1 + u*e
    const t = (x1 * ey - y1 * ex) / denom;
    const u = (x1 * dy - y1 * dx) / denom;
    if (t >= 0 && t <= maxDist && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// ---------------------------------------------------------------- エンコード済みポリライン

/** Google Encoded Polyline（OpenTripPlanner の legGeometry など）を [経度, 緯度] 配列に変換 */
export function decodePolyline(str: string, precision = 5): LonLat[] {
  const factor = 10 ** precision;
  const coords: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= str.length) throw new Error("invalid polyline");
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

export function isValidLatLon(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** 日本周辺（離島を含むおおまかな範囲）。サービス対象地域の判定に使う */
export function isWithinJapan(lat: number, lon: number): boolean {
  return lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154;
}
