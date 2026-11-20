import type { NextRequest } from "next/server";
import { apiError, apiOk, internalError, rateLimit } from "@/lib/http/api";
import { ProviderError } from "@/lib/http/fetch";
import { geocodeCache, suggestCache } from "@/lib/providers/geocoding";
import { buildProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/geocode?q=東京駅 — 地名・住所・駅名の検索（Enter／「駅・施設も検索」押下時）
 * GET /api/v1/geocode?q=kyoto&mode=suggest&lang=en — 入力中の候補（Photon＋国土地理院。Nominatim は入力補完に使わない）
 */
export async function GET(req: NextRequest) {
  const suggest = req.nextUrl.searchParams.get("mode") === "suggest";
  const limited = rateLimit(req, suggest ? "geocode-suggest" : "geocode");
  if (limited) return limited;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1 || q.length > 100) return apiError(400, "invalid_query");

  const { geocoder, suggester } = buildProviders();
  const provider = suggest ? suggester : geocoder;
  if (!provider) return apiError(503, "geocoding_not_configured");
  const cache = suggest ? suggestCache : geocodeCache;
  const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "ja";
  try {
    const results = await cache.getOrLoad(`${lang}:${q.normalize("NFKC")}`, () => provider.search(q, { lang }));
    return apiOk({ query: q, results }, { req });
  } catch (e) {
    if (e instanceof ProviderError) return apiError(502, e.kind === "timeout" ? "geocoding_timeout" : "geocoding_error");
    return internalError("geocode", e);
  }
}
