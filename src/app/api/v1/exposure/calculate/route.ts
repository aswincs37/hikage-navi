import type { NextRequest } from "next/server";
import type { LegMode, RouteAlternative } from "@/lib/domain/types";
import { proportionalOffsets, lineLengthM } from "@/lib/geo/geometry";
import { apiError, apiOk, internalError, rateLimit, readJsonBody } from "@/lib/http/api";
import { evaluateSegments, summariseExposure, vehicleSideExposure } from "@/lib/solar/exposure";
import { addSeconds, parseDateTime, toTokyoIso } from "@/lib/time/tokyo";
import { exposureRequestSchema } from "@/lib/validation/schemas";
import type { ProviderNotice } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/exposure/calculate — 任意の経路形状（車・バス・電車）に対する車内左右の日差し推定。
 * 所要時間は距離に比例して各区間に配分する（実際の速度の変化は考慮しない）。
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(req, "calc");
  if (limited) return limited;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const v = exposureRequestSchema.safeParse(parsed.body);
  if (!v.success) return apiError(400, "invalid_request", v.error.issues.map((i) => ({ field: i.path.join("."), code: `invalid_${i.code}` })));
  const departure = parseDateTime(v.data.departure);
  if (!departure) return apiError(400, "invalid_request", [{ field: "departure", code: "invalid_datetime" }]);

  const { geometry, durationSec, mode } = v.data;
  const route: RouteAlternative = {
    id: "custom",
    mode: mode === "rail" ? "train" : mode,
    legs: [
      {
        mode: mode as LegMode,
        outdoor: false,
        startTime: toTokyoIso(departure),
        endTime: toTokyoIso(addSeconds(departure, durationSec)),
        durationSec,
        distanceM: lineLengthM(geometry),
        geometry,
        vertexOffsetsSec: proportionalOffsets(geometry, durationSec),
      },
    ],
    startTime: toTokyoIso(departure),
    endTime: toTokyoIso(addSeconds(departure, durationSec)),
    durationSec,
    distanceM: lineLengthM(geometry),
    walkingSec: 0,
    source: { provider: "client", kind: "estimate", note: "client_supplied_geometry" },
  };
  try {
    // 道路・電車の乗車区間のみのため、建物の影は使わない
    const notices: ProviderNotice[] = [];
    const segments = evaluateSegments(route, { shadeModel: null });
    return apiOk({
      segments,
      exposure: summariseExposure(segments, { hasWeather: false }),
      vehicleSides: vehicleSideExposure(segments, route),
      notices,
    });
  } catch (e) {
    return internalError("exposure/calculate", e);
  }
}
