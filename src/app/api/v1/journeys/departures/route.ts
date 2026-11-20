import type { NextRequest } from "next/server";
import { apiError, apiOk, internalError, rateLimit, readJsonBody } from "@/lib/http/api";
import { compareDepartures } from "@/lib/journey/search";
import { buildProviders } from "@/lib/providers/registry";
import { validateDepartureTimes, validateJourneyRequest } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST /api/v1/journeys/departures — 同じ日の複数の出発時刻を比較 */
export async function POST(req: NextRequest) {
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const body = (parsed.body ?? {}) as Record<string, unknown>;
  const times = validateDepartureTimes(body.times);
  if (!times.ok) return apiError(400, "invalid_request", times.issues);
  // 時刻の数だけ重く数える
  const limited = rateLimit(req, "search", times.value.length);
  if (limited) return limited;
  const v = validateJourneyRequest(body);
  if (!v.ok) return apiError(400, "invalid_request", v.issues);
  try {
    const result = await compareDepartures(v.value, times.value, buildProviders());
    // 比較表には区間ごとの詳細は不要なので応答を小さくする
    for (const o of result.options) if (o.best) o.best = { ...o.best, segments: [] };
    return apiOk(result, { req });
  } catch (e) {
    return internalError("journeys/departures", e);
  }
}
