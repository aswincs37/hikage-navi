import "server-only";
import { gzipSync } from "node:zlib";
import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/lib/config/env";
import type { ValidationIssue } from "@/lib/validation/schemas";

/**
 * API ルートの共通処理。
 * - エラー応答は機械可読なコードのみ（スタックトレースや内部情報・APIキーは返さない）
 * - 位置情報を含むリクエスト内容はログに出さない
 */

const MAX_BODY_BYTES = 256 * 1024;

export function apiError(status: number, code: string, issues?: ValidationIssue[]) {
  return NextResponse.json({ error: { code, issues } }, { status, headers: { "Cache-Control": "no-store" } });
}

/** これより小さい応答は圧縮しない（圧縮の手間の方が大きい） */
const GZIP_MIN_BYTES = 1024;

/**
 * 正常応答。`req` を渡すと、ブラウザが対応していれば gzip で圧縮して返す
 * （電車の経路の結果は数十KBになるため、通信の遅い回線では圧縮の効果が大きい。
 * `next start` は API の応答を自動では圧縮しない）。
 */
export function apiOk(body: unknown, init?: { cacheSeconds?: number; req?: Request }) {
  const headers: Record<string, string> = {
    "Cache-Control": init?.cacheSeconds ? `public, max-age=${init.cacheSeconds}` : "no-store",
  };
  const json = JSON.stringify(body);
  if (init?.req && json.length >= GZIP_MIN_BYTES && /\bgzip\b/.test(init.req.headers.get("accept-encoding") ?? "")) {
    return new NextResponse(new Uint8Array(gzipSync(json, { level: 6 })), {
      headers: { ...headers, "Content-Type": "application/json", "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
    });
  }
  return new NextResponse(json, { headers: { ...headers, "Content-Type": "application/json" } });
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
 * IP アドレスごとの固定ウィンドウ方式のレート制限（プロセス内）。
 * サーバーレス環境ではインスタンスごとに独立するため厳密ではない。本番では
 * ホスティング側の WAF / レート制限機能と併用すること。IP アドレスは保存せず、メモリ上のみで扱う。
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown").slice(0, 64);
}

export function rateLimit(req: NextRequest, bucket: string, weight = 1): NextResponse | null {
  const limit = getConfig().rateLimitPerMinute;
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: weight, resetAt: now + 60_000 });
    return null;
  }
  b.count += weight;
  if (b.count > limit) {
    const res = apiError(429, "rate_limited");
    res.headers.set("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
    return res;
  }
  return null;
}

/** 予期しないエラーを、内部情報を含まない 500 応答にする */
export function internalError(where: string, e: unknown) {
  console.error(`[api] ${where} failed:`, e instanceof Error ? e.name : "unknown");
  return apiError(500, "internal_error");
}
