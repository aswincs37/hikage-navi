import { allowPublicDemoEndpoints, getConfig } from "@/lib/config/env";
import { readinessIssues } from "@/lib/config/readiness";
import { apiOk } from "@/lib/http/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/providers/status — 各機能のプロバイダー設定状態。
 * URL やキーは返さず、設定の有無と公開デモエンドポイントか否かのみ返す。
 * （外部への疎通確認はしない。呼び出しごとに外部APIへ負荷をかけないため）
 */
export async function GET() {
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
