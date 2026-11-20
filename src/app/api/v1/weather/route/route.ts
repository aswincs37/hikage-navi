import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOk, internalError, rateLimit, readJsonBody } from "@/lib/http/api";
import { ProviderError } from "@/lib/http/fetch";
import { buildProviders } from "@/lib/providers/registry";
import { parseDateTime } from "@/lib/time/tokyo";

export const dynamic = "force-dynamic";

const schema = z.object({
  points: z
    .array(z.object({ lat: z.number().finite().min(20).max(46), lon: z.number().finite().min(122).max(154), time: z.string().max(40) }))
    .min(1)
    .max(24),
});

/**
 * POST /api/v1/weather/route — 経路上の地点・通過時刻ごとの気象予報と公式WBGT予測値。
 * 各地点に、その時刻に最も近い予報値を対応付ける（出発地の現在値で代用しない）。
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "calc");
  if (limited) return limited;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const v = schema.safeParse(parsed.body);
  if (!v.success) return apiError(400, "invalid_request", [{ field: "points", code: "invalid_points" }]);
  const points = v.data.points.map((p) => ({ lat: p.lat, lon: p.lon, time: parseDateTime(p.time) }));
  if (points.some((p) => !p.time)) return apiError(400, "invalid_request", [{ field: "points.time", code: "invalid_datetime" }]);
  const query = points.map((p) => ({ ...p, time: p.time! }));

  const { weather, wbgt } = buildProviders();
  try {
    const [w, h] = await Promise.all([
      weather ? weather.forecast(query).catch((e) => (e instanceof ProviderError ? { error: e.kind } : Promise.reject(e))) : { error: "not_configured" },
      wbgt ? wbgt.forecast(query).catch((e) => (e instanceof ProviderError ? { error: e.kind } : Promise.reject(e))) : { error: "not_configured" },
    ]);
    return apiOk({ weather: w, wbgt: h });
  } catch (e) {
    return internalError("weather/route", e);
  }
}
