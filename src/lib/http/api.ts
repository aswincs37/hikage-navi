import "server-only";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/config/env";
import type { ValidationIssue } from "@/lib/validation/schemas";
import { redisPipeline } from "./redis";

/**
 * API ルートの共通処理。
 * - エラー応答は機械可読なコードのみ（スタックトレースや内部情報・APIキーは返さない）
 * - 位置情報を含むリクエスト内容はログに出さない
 */

const MAX_BODY_BYTES = 256 * 1024;

export function apiError(status: number, code: string, issues?: ValidationIssue[]) {
  return NextResponse.json({ error: { code, issues } }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * 正常応答（JSON）。
 * 圧縮（gzip など）はサーバー（Next.js 16.4.6 以降の `next start`、またはホスティング側）に任せる。
 * ここでも圧縮すると二重に圧縮され、ブラウザが読めなくなるため、自前では圧縮しない。
 */
export function apiOk(body: unknown, init?: { cacheSeconds?: number }) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": init?.cacheSeconds ? `public, max-age=${init.cacheSeconds}` : "no-store" },
  });
}

export async function readJsonBody(req: NextRequest): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return { ok: false, res: apiError(413, "payload_too_large") };
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, res: apiError(413, "payload_too_large") };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: apiError(400, "invalid_json") };
  }
}

// ---------------------------------------------------------------- レート制限

/**
 * IP アドレスごと・1分ごとの固定ウィンドウ方式のレート制限。
 * - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN があれば、全サーバー共通の回数を Redis（Upstash）で数える
 *   （サーバーレスでインスタンスが複数あっても正しく制限できる）。IP アドレスはハッシュ値にしてから送り、約70秒で消える
 * - 無い場合、または Redis が遅い・失敗した場合は、このサーバーのメモリ上だけで数える
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;

export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

/** IP アドレスをそのまま外部に送らないためのハッシュ（RATE_LIMIT_SALT で推測しにくくする） */
function hashedClient(req: NextRequest): string {
  return createHash("sha256")
    .update(`${process.env.RATE_LIMIT_SALT ?? "hikage-navi"}:${clientKey(req)}`)
    .digest("base64url")
    .slice(0, 22);
}

const DAY_MS = 86_400_000;

function limited(limit: number, count: number, resetAt: number, now: number, code: string): NextResponse | null {
  if (count <= limit) return null;
  const res = apiError(429, code);
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
  return res;
}

function memoryCount(key: string, weight: number, now: number, windowMs: number): { count: number; resetAt: number } {
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    const fresh = { count: weight, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  b.count += weight;
  return b;
}

/** Upstash Redis（REST）で数える。設定が無い・失敗したときは null */
async function redisCount(key: string, weight: number, windowStart: number, windowMs: number): Promise<number | null> {
  const redisKey = `hikage:rl:${key}:${windowStart}`;
  const result = await redisPipeline([
    ["INCRBY", redisKey, String(weight)],
    ["EXPIRE", redisKey, String(Math.ceil(windowMs / 1000) + 10)],
  ]);
  const n = Number(result?.[0]);
  return result && Number.isFinite(n) ? n : null;
}

/**
 * IP アドレスごとの回数制限。既定は1分あたり RATE_LIMIT_PER_MINUTE 回。
 * `limit` と `windowMs` を渡すと、別の上限・期間（1日など）で数える。
 */
export async function rateLimit(
  req: NextRequest,
  bucket: string,
  weight = 1,
  limit = getConfig().rateLimitPerMinute,
  windowMs = WINDOW_MS,
  code = "rate_limited",
): Promise<NextResponse | null> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const key = `${bucket}:${hashedClient(req)}`;
  const shared = await redisCount(key, weight, windowStart, windowMs);
  if (shared !== null) return limited(limit, shared, windowStart + windowMs, now, code);
  const local = memoryCount(`${key}:${windowMs}`, weight, now, windowMs);
  return limited(limit, local.count, local.resetAt, now, code);
}

/**
 * 経路検索（外部の無料サービスを最も多く使う）専用の制限。
 * 1分あたりの上限に加えて1日あたりの上限を設け、1人でサイト全体の1日の利用枠
 * （Overpass・Open-Meteo 無料版など）を使い切れないようにする。
 */
export async function searchRateLimit(req: NextRequest, weight = 1): Promise<NextResponse | null> {
  const c = getConfig();
  return (
    (await rateLimit(req, "search", weight, c.searchesPerMinute)) ??
    (await rateLimit(req, "search-day", weight, c.searchesPerDay, DAY_MS, "daily_limit_reached"))
  );
}

/** 予期しないエラーを、内部情報を含まない 500 応答にする */
export function internalError(where: string, e: unknown) {
  console.error(`[api] ${where} failed:`, e instanceof Error ? e.name : "unknown");
  return apiError(500, "internal_error");
}
