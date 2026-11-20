import "server-only";
import { allowPublicDemoEndpoints, getConfig, type AppConfig } from "./env";
import { getSiteInfo, legalPagesFinal, type SiteInfo } from "./site";

/**
 * 本番公開の準備状況の確認。サーバー起動時（instrumentation.ts）にログへ出し、
 * /api/v1/providers/status でも返す（URL・キーなどの値そのものは返さない）。
 *
 * level: "error" = 主要な機能が動かない、"warn" = 動くが本番では直すべき
 */
export interface ReadinessIssue {
  level: "error" | "warn";
  code: string;
  /** 運用者向けの説明（英語。ログに出す） */
  message: string;
}

export function readinessIssues(
  c: AppConfig = getConfig(),
  site: SiteInfo = getSiteInfo(),
  env: NodeJS.ProcessEnv = process.env,
): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const add = (level: ReadinessIssue["level"], code: string, message: string) => out.push({ level, code, message });

  if (!c.geocoding.gsi && !c.geocoding.nominatim && !c.geocoding.photon) {
    add("error", "no_geocoder", "Place search is off. Set NOMINATIM_URL / PHOTON_URL / GSI_GEOCODER_URL, or ALLOW_PUBLIC_DEMO_ENDPOINTS=true.");
  }
  if (!c.routing.car) {
    add("error", "no_car_routing", "Car routes are off. Set OSRM_CAR_URL (self-hosted OSRM), or ALLOW_PUBLIC_DEMO_ENDPOINTS=true.");
  }
  if (!c.transit) add("warn", "no_transit", "Train routes are off (rail network file missing or TRANSIT_PROVIDER=none).");
  if (!c.weather) add("warn", "no_weather", "Weather is off. Set OPEN_METEO_API_KEY (commercial plan) or ALLOW_PUBLIC_DEMO_ENDPOINTS=true.");
  if (!c.wbgt) add("warn", "no_wbgt", "Official heat index (WBGT) is off. Set MOE_WBGT_FORECAST_URL and JMA_AMEDAS_TABLE_URL, or ALLOW_PUBLIC_DEMO_ENDPOINTS=true.");
  if (!c.shade) add("warn", "no_shade", "Building shade is off. Set OVERPASS_URL, or ALLOW_PUBLIC_DEMO_ENDPOINTS=true.");
  if (allowPublicDemoEndpoints()) {
    add("warn", "public_demo_endpoints", "Free public servers (OSRM, Overpass, Nominatim, Open-Meteo free tier) are in use. Fine for a small pilot; not for commercial or heavy use.");
  }
  if (!env.HTTP_USER_AGENT?.trim() && !site.url) {
    add("warn", "user_agent", "Set SITE_URL (or HTTP_USER_AGENT) so external services can identify and contact the operator.");
  }
  if (!(env.UPSTASH_REDIS_REST_URL?.trim() && env.UPSTASH_REDIS_REST_TOKEN?.trim())) {
    add("warn", "rate_limit_per_instance", "Rate limiting is per server instance. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN, or use your host's firewall rate limits.");
  }
  if (!legalPagesFinal(site)) {
    add("warn", "legal_draft", "Terms / privacy / contact are drafts. Set SITE_OPERATOR_NAME, CONTACT_EMAIL or CONTACT_FORM_URL, LEGAL_COURT, and LEGAL_REVIEWED=true after legal review.");
  }
  return out;
}
