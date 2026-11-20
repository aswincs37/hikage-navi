#!/usr/bin/env node
/**
 * 日本の旅客鉄道の線路網と駅を OpenStreetMap（Overpass API）から取得し、
 * 経路探索用のコンパクトなネットワークファイル（data/rail/japan-rail.json.gz）を作る。
 *
 * - 1°×1° のタイルごとに取得し、.cache/rail-tiles/ に保存する（途中で止めても再開できる）
 * - 側線・車庫線（service=*）や貨物専用線（usage=freight 等）は除く
 * - 分岐点（2本以上の線路が共有するノード）と線路の端点だけをノードとして残し、間の形状は約8m精度で間引く
 *
 * 使い方:  node scripts/build-rail-network.mjs [--only-tiles] [--build-only]
 * 環境変数: OVERPASS_URL（既定 https://overpass-api.de/api/interpreter）, HTTP_USER_AGENT
 * データは ODbL。表示時は「© OpenStreetMap contributors」の帰属表示が必要。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const TILE_DIR = path.join(ROOT, ".cache", "rail-tiles");
const OUT = path.join(ROOT, "data", "rail", "japan-rail.json.gz");
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const UA = process.env.HTTP_USER_AGENT || "hikage-navi-rail-build/0.1";
const args = new Set(process.argv.slice(2));

/** 日本の陸地をおおまかに覆う範囲（緯度 from-to, 経度 from-to）。この範囲に掛かる 1° タイルだけを取得する */
const LAND = [
  [26, 27, 127, 129], // 沖縄本島
  [31, 34, 129, 132], // 九州
  [33, 37, 130, 141], // 中国・四国・近畿・中部・関東
  [36, 42, 137, 142], // 北陸・東北
  [41, 46, 139, 146], // 北海道
];

function tiles() {
  // RAIL_TILES="35_136,34_135" で取得するタイルを限定できる（試験用）
  if (process.env.RAIL_TILES) return process.env.RAIL_TILES.split(",").map((s) => s.split("_").map(Number));
  const set = new Map();
  for (const [la1, la2, lo1, lo2] of LAND)
    for (let la = la1; la < la2; la++) for (let lo = lo1; lo < lo2; lo++) set.set(`${la}_${lo}`, [la, lo]);
  return [...set.values()];
}

const RAIL = '"railway"~"^(rail|subway|light_rail|monorail|narrow_gauge)$"';
function tileQuery(la, lo) {
  const bb = `${la},${lo},${la + 1},${lo + 1}`;
  return (
    `[out:json][timeout:240];(` +
    `way[${RAIL}]["service"!~"."]["usage"!~"^(freight|industrial|military|tourism|test)$"]["access"!~"^(no|private)$"](${bb});` +
    `node["railway"~"^(station|halt)$"]["name"](${bb});` +
    `);out body geom qt;`
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Overpass に問い合わせる（混雑時は待って再試行）。取得できなければ null */
async function overpass(query, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = JSON.parse(text);
      if (data.remark && /error|timed out|runtime/i.test(data.remark)) throw new Error(`remark: ${data.remark}`);
      return data;
    } catch (e) {
      const wait = Math.min(120_000, 10_000 * 2 ** (attempt - 1));
      console.warn(`${label} attempt ${attempt} failed: ${e.message}; retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  return null;
}

/**
 * 以前の形式（運営会社なし）で保存したタイルに、運営会社（operator）だけを追加する。
 * 形状を取り直さずタグだけを取得するので軽い。
 */
async function enrichTile(file, la, lo) {
  const started = Date.now();
  const q = tileQuery(la, lo).replace("out body geom qt;", "out tags qt;");
  const data = await overpass(q, `enrich ${la},${lo}`);
  if (!data) return false;
  const op = new Map();
  for (const el of data.elements ?? []) if (el.tags?.operator) op.set(`${el.type}:${el.id}`, el.tags.operator);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const w of d.ways) {
    const o = op.get(`way:${w.id}`);
    if (o) w.t.operator = o;
  }
  for (const st of d.stations) st.op = op.get(`node:${st.id}`) ?? "";
  d.v = 2;
  fs.writeFileSync(file, JSON.stringify(d));
  console.log(`enriched ${la},${lo}: ${op.size} operators (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  return true;
}

async function fetchTile(la, lo) {
  const file = path.join(TILE_DIR, `${la}_${lo}.json`);
  if (fs.existsSync(file)) {
    const v = JSON.parse(fs.readFileSync(file, "utf8")).v;
    return v === 2 ? true : enrichTile(file, la, lo);
  }
  const started = Date.now();
  const data = await overpass(tileQuery(la, lo), `tile ${la},${lo}`);
  if (!data) {
    console.warn(`tile ${la},${lo}: giving up for now (will retry in the next pass)`);
    return false;
  }
  const ways = [];
  const stations = [];
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === "way" && Array.isArray(el.nodes) && Array.isArray(el.geometry) && el.nodes.length >= 2) {
      ways.push({
        id: el.id,
        n: el.nodes,
        g: el.geometry.map((p) => (p ? [Math.round(p.lon * 1e5), Math.round(p.lat * 1e5)] : null)),
        t: pick(t, ["railway", "highspeed", "name", "name:en", "tunnel", "layer", "usage", "operator"]),
      });
    } else if (el.type === "node" && t.name) {
      stations.push({ id: el.id, x: Math.round(el.lon * 1e5), y: Math.round(el.lat * 1e5), name: t.name, en: t["name:en"] ?? "", s: t.station ?? "", op: t.operator ?? "" });
    }
  }
  fs.writeFileSync(file, JSON.stringify({ v: 2, ways, stations }));
  console.log(`tile ${la},${lo}: ${ways.length} ways, ${stations.length} stations (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  return true;
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

/** 線路の種類 → 速度区分（0 新幹線・高速線, 1 在来線, 2 地下鉄, 3 ライトレール・モノレール・軽便） */
function speedClass(t) {
  if (t.highspeed === "yes") return 0;
  if (t.railway === "subway") return 2;
  if (t.railway === "rail") return 1;
  return 3;
}

const M_PER_DEG = 111_320;
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * 1e-5 * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 1e-5 * M_PER_DEG * Math.cos(lat);
  const dy = (b[1] - a[1]) * 1e-5 * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** Douglas-Peucker（メートル換算）。始点・終点は残す */
function simplify(pts, tolM) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const cos = Math.cos(pts[0][1] * 1e-5 * (Math.PI / 180));
  const xy = (p) => [p[0] * 1e-5 * M_PER_DEG * cos, p[1] * 1e-5 * M_PER_DEG];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = xy(pts[i]);
    const [bx, by] = xy(pts[j]);
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bi = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = xy(pts[k]);
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
      if (d > best) {
        best = d;
        bi = k;
      }
    }
    if (best > tolM) {
      keep[bi] = 1;
      stack.push([i, bi], [bi, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

function build() {
  const files = fs.readdirSync(TILE_DIR).filter((f) => f.endsWith(".json"));
  const ways = new Map();
  const stations = new Map();
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(TILE_DIR, f), "utf8"));
    for (const w of d.ways) if (!ways.has(w.id) && w.g.every(Boolean)) ways.set(w.id, w);
    for (const s of d.stations) stations.set(s.id, s);
  }
  // 分岐点: 2本以上の線路で共有されるノード、または線路の端点
  const uses = new Map();
  for (const w of ways.values()) {
    const seen = new Set();
    for (const n of w.n) {
      if (seen.has(n)) continue;
      seen.add(n);
      uses.set(n, (uses.get(n) ?? 0) + 1);
    }
  }
  const nodeIndex = new Map();
  const nodes = [];
  const nodeId = (osmId, p) => {
    let i = nodeIndex.get(osmId);
    if (i === undefined) {
      i = nodes.length / 2;
      nodeIndex.set(osmId, i);
      nodes.push(p[0], p[1]);
    }
    return i;
  };
  const names = [];
  const nameIdx = new Map();
  const nameOf = (s) => {
    if (!s) return -1;
    let i = nameIdx.get(s);
    if (i === undefined) {
      i = names.length;
      names.push(s);
      nameIdx.set(s, i);
    }
    return i;
  };
  const ea = [], eb = [], elen = [], ecls = [], ename = [], etun = [], egeom = [], eop = [];
  for (const w of ways.values()) {
    const cls = speedClass(w.t);
    const nm = nameOf(w.t.name);
    const op = nameOf(w.t.operator);
    const tunnel = w.t.tunnel && w.t.tunnel !== "no" ? 1 : 0;
    let start = 0;
    for (let k = 1; k < w.n.length; k++) {
      const isJunction = k === w.n.length - 1 || (uses.get(w.n[k]) ?? 0) > 1;
      if (!isJunction) continue;
      const pts = w.g.slice(start, k + 1);
      let len = 0;
      for (let q = 1; q < pts.length; q++) len += distM(pts[q - 1], pts[q]);
      if (len < 0.5) {
        start = k;
        continue;
      }
      const a = nodeId(w.n[start], pts[0]);
      const b = nodeId(w.n[k], pts[pts.length - 1]);
      const inner = simplify(pts, 8).slice(1, -1);
      const enc = [];
      let prev = pts[0];
      for (const p of inner) {
        enc.push(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
      }
      ea.push(a);
      eb.push(b);
      elen.push(Math.round(len));
      ecls.push(cls);
      ename.push(nm);
      etun.push(tunnel);
      egeom.push(enc);
      eop.push(op);
      start = k;
    }
  }
  const st = [...stations.values()].map((s) => [s.name, s.en, s.x, s.y, s.s === "subway" ? 1 : 0, s.op ?? ""]);
  const out = {
    v: 1,
    generated: new Date().toISOString(),
    attribution: "© OpenStreetMap contributors (ODbL)",
    nodes,
    edges: { a: ea, b: eb, len: elen, cls: ecls, name: ename, tunnel: etun, geom: egeom, op: eop },
    names,
    stations: st,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const gz = zlib.gzipSync(JSON.stringify(out), { level: 9 });
  fs.writeFileSync(OUT, gz);
  console.log(`built ${OUT}: ${nodes.length / 2} nodes, ${ea.length} edges, ${st.length} stations, ${(gz.length / 1e6).toFixed(1)} MB`);
}

fs.mkdirSync(TILE_DIR, { recursive: true });
if (!args.has("--build-only")) {
  // 混雑で取得できなかったタイルは後回しにし、最大5巡まで取り直す
  let pending = tiles();
  console.log(`${pending.length} tiles`);
  for (let pass = 1; pass <= 5 && pending.length > 0; pass++) {
    const failed = [];
    for (const [la, lo] of pending) {
      if (!(await fetchTile(la, lo))) failed.push([la, lo]);
      await sleep(2000);
    }
    pending = failed;
    if (pending.length) {
      console.warn(`pass ${pass}: ${pending.length} tiles still missing: ${pending.map((t) => t.join("_")).join(", ")}`);
      await sleep(60_000);
    }
  }
  if (pending.length) {
    console.error("Some tiles could not be fetched. Run the script again later (finished tiles are kept), or use --build-only for a partial network.");
    process.exit(1);
  }
}
if (!args.has("--only-tiles")) build();
