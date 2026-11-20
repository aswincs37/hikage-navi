import type { NextRequest } from "next/server";
import { apiError, apiOk, rateLimit, readJsonBody } from "@/lib/http/api";
import { SOLAR_LIBRARY, solarPosition } from "@/lib/solar/position";
import { parseDateTime, toTokyoIso } from "@/lib/time/tokyo";
import { sunPositionSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/** POST /api/v1/sun/position — 指定地点・日時の太陽位置（天文計算） */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "calc");
  if (limited) return limited;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const v = sunPositionSchema.safeParse(parsed.body);
  if (!v.success) return apiError(400, "invalid_request", v.error.issues.map((i) => ({ field: i.path.join("."), code: `invalid_${i.code}` })));
  const date = parseDateTime(v.data.datetime);
  if (!date) return apiError(400, "invalid_request", [{ field: "datetime", code: "invalid_datetime" }]);
  return apiOk({
    lat: v.data.lat,
    lon: v.data.lon,
    datetime: toTokyoIso(date),
    position: solarPosition(v.data.lat, v.data.lon, date),
    source: { provider: "astronomy-engine", kind: "astronomical", library: SOLAR_LIBRARY },
  });
}
