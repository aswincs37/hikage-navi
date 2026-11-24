import { allowPublicDemoEndpoints, getConfig } from "@/lib/config/env";
import { readinessIssues } from "@/lib/config/readiness";
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/http/api";

/**
 * 開発中は誰でも見られる。本番では STATUS_TOKEN を設定し、
 * `Authorization: Bearer <STATUS_TOKEN>` を付けたときだけ返す（未設定なら本番では常に 404）。
 */
function statusAllowed(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const token = process.env.STATUS_TOKEN?.trim();
  if (!token) return false;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  // 長さの違いも含めて比べる時間を一定にするため、ハッシュ同士を比べる
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(token));
}

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/providers/status — 各機能のプロバイダー設定状態。
 * URL やキーは返さず、設定の有無と公開デモエンドポイントか否かのみ返す。
 * （外部への疎通確認はしない。呼び出しごとに外部APIへ負荷をかけないため）
 */
export async function GET(req: NextRequest) {
  // 本番では運用者だけが見られるようにする（トークンが無い・違うときは、存在しないページと同じ 404）
  if (!statusAllowed(req)) return apiError(404, "not_found");
  const c = getConfig();
  const st = (e: { publicDemo: boolean } | null | undefined) => (e ? (e.publicDemo ? "demo_endpoint" : "configured") : "not_configured");
  return apiOk({
    geocoding: { gsi: st(c.geocoding.gsi), nominatim: st(c.geocoding.nominatim) },
    routing: { car: st(c.routing.car) },
    transit: c.transit ? "configured" : "not_configured",
    weather: st(c.weather?.endpoint),
    uv: st(c.weather?.endpoint),
    wbgt: st(c.wbgt?.forecast),
    shade: st(c.shade?.endpoint),
    publicDemoEndpointsAllowed: allowPublicDemoEndpoints(),
    rateLimit: process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? "shared" : "per_instance",
    /** 本番公開の準備状況（コードのみ。設定値は返さない）。空なら準備完了 */
    readiness: readinessIssues().map((i) => ({ level: i.level, code: i.code })),
  });
}
