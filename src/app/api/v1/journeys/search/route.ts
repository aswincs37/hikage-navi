import type { NextRequest } from "next/server";
import { apiError, apiOk, internalError, readJsonBody, searchRateLimit } from "@/lib/http/api";
import { searchJourney } from "@/lib/journey/search";
import { searchCache, searchCacheKey, worthKeeping } from "@/lib/journey/searchCache";
import { buildProviders } from "@/lib/providers/registry";
import { validateJourneyRequest } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/v1/journeys/search — 経路検索と日差し・気象・暑さ指数の評価 */
export async function POST(req: NextRequest) {
  const limited = await searchRateLimit(req);
  if (limited) return limited;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const v = validateJourneyRequest(parsed.body);
  if (!v.ok) return apiError(400, "invalid_request", v.issues);
  try {
    const result = await searchCache.getOrCreate(searchCacheKey(v.value), () => searchJourney(v.value, buildProviders()), worthKeeping);
    return apiOk(result);
  } catch (e) {
    return internalError("journeys/search", e);
  }
}
