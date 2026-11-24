import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * プロバイダー設定（すべて環境変数）。サーバー側でのみ読み込む。
 *
 * 公開デモ用エンドポイント（FOSSGIS の OSRM、Overpass 公開インスタンス、Open-Meteo 無料 API など）は
 * 商用・大量利用を前提としていない。開発環境では既定で使うが、本番では
 * ALLOW_PUBLIC_DEMO_ENDPOINTS=true を明示しない限り使わない。
 */

export interface Endpoint {
  url: string;
  /** 公開デモ／無料枠エンドポイントか（画面に表示する） */
  publicDemo: boolean;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function num(name: string, fallback: number): number {
  const v = Number(env(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function allowPublicDemoEndpoints(): boolean {
  const flag = env("ALLOW_PUBLIC_DEMO_ENDPOINTS");
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV !== "production";
}

function endpoint(configured: string | undefined, publicDefault: string | undefined): Endpoint | null {
  if (configured) return { url: configured.replace(/\/+$/, ""), publicDemo: false };
  if (publicDefault && allowPublicDemoEndpoints()) return { url: publicDefault, publicDemo: true };
  return null;
}

export const PUBLIC_DEFAULTS = {
  gsiGeocoder: "https://msearch.gsi.go.jp/address-search/AddressSearch",
  nominatim: "https://nominatim.openstreetmap.org/search",
  photon: "https://photon.komoot.io/api/",
  osrmCar: "https://routing.openstreetmap.de/routed-car",
  openMeteo: "https://api.open-meteo.com/v1/forecast",
  overpass: "https://overpass-api.de/api/interpreter",
  moeWbgtForecast: "https://www.wbgt.env.go.jp/prev15WG/dl/yohou_all.csv",
  jmaAmedasTable: "https://www.jma.go.jp/bosai/amedas/const/amedastable.json",
} as const;

export function getConfig() {
  const weatherProvider = env("WEATHER_PROVIDER") ?? "open-meteo";
  const openMeteoKey = env("OPEN_METEO_API_KEY");
  return {
    userAgent: userAgent(),
    requestTimeoutMs: num("PROVIDER_TIMEOUT_MS", 12_000),
    rateLimitPerMinute: num("RATE_LIMIT_PER_MINUTE", 30),
    /** 経路検索だけの上限（1つのIPあたり）。比較は時刻の数だけ数える */
    searchesPerMinute: num("RATE_LIMIT_SEARCHES_PER_MINUTE", 10),
    searchesPerDay: num("RATE_LIMIT_SEARCHES_PER_DAY", 300),

    geocoding: {
      gsi: env("GSI_GEOCODER_URL") === "none" ? null : endpoint(env("GSI_GEOCODER_URL"), PUBLIC_DEFAULTS.gsiGeocoder),
      nominatim: env("NOMINATIM_URL") === "none" ? null : endpoint(env("NOMINATIM_URL"), PUBLIC_DEFAULTS.nominatim),
      photon: env("PHOTON_URL") === "none" ? null : endpoint(env("PHOTON_URL"), PUBLIC_DEFAULTS.photon),
    },

    routing: {
      car: endpoint(env("OSRM_CAR_URL"), PUBLIC_DEFAULTS.osrmCar),
    },

    /**
     * 電車の経路。
     * - TRANSIT_PROVIDER=otp: OpenTripPlanner（時刻表あり）
     * - 既定: OpenStreetMap の線路網から推定（時刻表なし）。ネットワークファイルがある場合のみ
     * - TRANSIT_PROVIDER=none: 使わない
     */
    transit: transitConfig(),

    weather:
      weatherProvider === "none"
        ? null
        : openMeteoKey
          ? {
              endpoint: { url: env("OPEN_METEO_URL") ?? "https://customer-api.open-meteo.com/v1/forecast", publicDemo: false },
              apiKey: openMeteoKey,
            }
          : (() => {
              const e = endpoint(env("OPEN_METEO_URL"), PUBLIC_DEFAULTS.openMeteo);
              return e ? { endpoint: e, apiKey: undefined } : null;
            })(),
    /** これより先の時刻の予報は不確実性が大きいため表示しない（日） */
    weatherMaxLeadDays: num("WEATHER_MAX_LEAD_DAYS", 7),

    wbgt:
      env("WBGT_PROVIDER") === "none"
        ? null
        : (() => {
            const forecast = endpoint(env("MOE_WBGT_FORECAST_URL"), PUBLIC_DEFAULTS.moeWbgtForecast);
            const stations = endpoint(env("JMA_AMEDAS_TABLE_URL"), PUBLIC_DEFAULTS.jmaAmedasTable);
            return forecast && stations ? { forecast, stations, maxStationDistanceKm: num("WBGT_MAX_STATION_KM", 25) } : null;
          })(),

    shade:
      env("SHADE_PROVIDER") === "none"
        ? null
        : (() => {
            const e = endpoint(env("OVERPASS_URL"), PUBLIC_DEFAULTS.overpass);
            return e ? { endpoint: e, maxRouteKm: num("SHADE_MAX_ROUTE_KM", 5), timeoutMs: num("SHADE_TIMEOUT_MS", 35_000) } : null;
          })(),
  };
}

export type AppConfig = ReturnType<typeof getConfig>;

/**
 * 外部サービスへ名乗る名前。Nominatim などの無料サービスは、運営者が分かる User-Agent を求めている。
 * HTTP_USER_AGENT が無ければ、公開URL（SITE_URL）から作る。
 */
function userAgent(): string {
  const explicit = env("HTTP_USER_AGENT");
  if (explicit) return explicit;
  const site = env("SITE_URL");
  return site ? `hikage-navi/1.0 (+${site.replace(/\/+$/, "")})` : "hikage-navi/0.1 (development)";
}

function transitConfig() {
  const provider = env("TRANSIT_PROVIDER");
  if (provider === "none") return null;
  if (provider === "otp") {
    const url = env("OTP_GRAPHQL_URL");
    return url ? { provider: "otp" as const, url, apiKey: env("OTP_API_KEY") } : null;
  }
  const file = env("RAIL_NETWORK_PATH") ?? path.join(process.cwd(), "data", "rail", "japan-rail.json.gz");
  return fs.existsSync(file) ? { provider: "osm-rail" as const, file } : null;
}
