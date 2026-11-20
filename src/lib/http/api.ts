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

function limited(limit: number, count: number, resetAt: number, now: number): NextResponse | null {
  if (count <= limit) return null;
  const res = apiError(429, "rate_limited");
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
  return res;
}

function memoryCount(key: string, weight: number, now: number): { count: number; resetAt: number } {
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    const fresh = { count: weight, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return fresh;
  }
  b.count += weight;
  return b;
}

/** Upstash Redis（REST）で数える。設定が無い・失敗したときは null */
async function redisCount(key: string, weight: number, windowStart: number): Promise<number | null> {
  const redisKey = `hikage:rl:${key}:${windowStart}`;
  const result = await redisPipeline([
    ["INCRBY", redisKey, String(weight)],
    ["EXPIRE", redisKey, "70"],
  ]);
  const n = Number(result?.[0]);
  return result && Number.isFinite(n) ? n : null;
}

export async function rateLimit(req: NextRequest, bucket: string, weight = 1): Promise<NextResponse | null> {
  const limit = getConfig().rateLimitPerMinute;
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  const key = `${bucket}:${hashedClient(req)}`;
  const shared = await redisCount(key, weight, windowStart);
  if (shared !== null) return limited(limit, shared, windowStart + WINDOW_MS, now);
  const local = memoryCount(key, weight, now);
  return limited(limit, local.count, local.resetAt, now);
}

/** 予期しないエラーを、内部情報を含まない 500 応答にする */
export function internalError(where: string, e: unknown) {
  console.error(`[api] ${where} failed:`, e instanceof Error ? e.name : "unknown");
  return apiError(500, "internal_error");
}
