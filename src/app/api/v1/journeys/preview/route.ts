import type { NextRequest } from "next/server";
import { apiError, apiOk, internalError, rateLimit } from "@/lib/http/api";
import { TtlCache } from "@/lib/http/memoCache";
import { previewJourney, type JourneyPreview } from "@/lib/journey/preview";
import { buildProviders } from "@/lib/providers/registry";
import { validateJourneyRequest } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * 道路の形は時刻で変わらないため長く（1日）、電車は出発時刻ごとに短く（1時間）メモリ上に持つ。
 * 同じ区間を何人が見ても、外部の経路サーバーへは1回だけ問い合わせる。
 */
const ROAD_TTL_MS = 24 * 3_600_000;
const TRAIN_TTL_MS = 3_600_000;
const cache = new TtlCache<JourneyPreview | null>(500, ROAD_TTL_MS);

/**
 * GET /api/v1/journeys/preview?olat=&olon=&dlat=&dlon=&m=&t=
 * 検索前の地図用に、経路の形だけを返す（日差しの計算はしない）。
 * GET にすることで、ブラウザも同じ区間の結果を再利用できる。
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "preview");
  if (limited) return limited;
  const q = req.nextUrl.searchParams;
  const num = (k: string) => {
    const s = q.get(k);
    return s === null || s.trim() === "" ? NaN : Number(s);
  };
  const v = validateJourneyRequest({
    origin: { lat: num("olat"), lon: num("olon") },
    destination: { lat: num("dlat"), lon: num("dlon") },
    departure: q.get("t") ?? "",
    mode: q.get("m") ?? "",
  });
  if (!v.ok) return apiError(400, "invalid_request", v.issues);
  const r = v.value;
  const road = r.mode === "car";
  const key = [r.mode, r.origin.lat.toFixed(5), r.origin.lon.toFixed(5), r.destination.lat.toFixed(5), r.destination.lon.toFixed(5), road ? "" : q.get("t")].join("|");
  try {
    let preview = cache.get(key);
    if (preview === undefined) {
      preview = await previewJourney(r, buildProviders());
      cache.set(key, preview, road ? ROAD_TTL_MS : TRAIN_TTL_MS);
    }
    if (!preview) return apiError(404, "no_route");
    return apiOk(preview, { cacheSeconds: road ? 86_400 : 3_600 });
  } catch (e) {
    return internalError("journeys/preview", e);
  }
}
