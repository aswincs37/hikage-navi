import type { Endpoint } from "@/lib/config/env";
import type { LonLat, Place, RouteAlternative } from "@/lib/domain/types";
import { proportionalOffsets } from "@/lib/geo/geometry";
import { fetchJson, ProviderError } from "@/lib/http/fetch";
import { addSeconds, toTokyoIso } from "@/lib/time/tokyo";
import type { StreetRoutingProvider } from "./types";

/**
 * OSRM（Open Source Routing Machine）アダプター。徒歩・自転車・自動車それぞれ別のプロファイル
 * （別サーバーまたは別プロファイル名）を使う。徒歩経路を自転車に流用しない。
 *
 * OSRM は時刻による渋滞を考慮しないため、所要時間は出発時刻に依存しない。
 */

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { type: "LineString"; coordinates: [number, number][] };
    legs: { annotation?: { duration?: number[]; distance?: number[] } }[];
  }[];
}

export class OsrmRoutingProvider implements StreetRoutingProvider {
  readonly id: string;
  constructor(
    private readonly mode: "car",
    private readonly endpoint: Endpoint,
    private readonly http: { timeoutMs: number; userAgent: string },
    private readonly profile = "driving",
  ) {
    this.id = `osrm-${mode}`;
  }

  async route(origin: Place, destination: Place, departure: Date): Promise<RouteAlternative[]> {
    const coords = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
    const params = new URLSearchParams({
      overview: "full",
      geometries: "geojson",
      alternatives: "3",
      annotations: "duration,distance",
      steps: "false",
    });
    const url = `${this.endpoint.url}/route/v1/${this.profile}/${coords}?${params}`;
    let data: OsrmResponse;
    try {
      data = await fetchJson<OsrmResponse>(url, { provider: this.id, ...this.http });
    } catch (e) {
      // OSRM は経路が無い場合に 400 + code: "NoRoute" を返すことがある
      if (e instanceof ProviderError && e.kind === "http" && e.status === 400) return [];
      throw e;
    }
    return normaliseOsrm(data, this.mode, departure, this.id, this.endpoint.publicDemo);
  }
}

export function normaliseOsrm(
  data: OsrmResponse,
  mode: "car",
  departure: Date,
  providerId: string,
  publicDemo = false,
): RouteAlternative[] {
  if (data.code === "NoRoute" || data.code === "NoSegment") return [];
  if (data.code !== "Ok" || !Array.isArray(data.routes)) throw new ProviderError("parse", providerId);
  const retrievedAt = new Date().toISOString();

  return data.routes
    .filter((r) => r.geometry?.coordinates?.length >= 2 && Number.isFinite(r.duration) && Number.isFinite(r.distance))
    .map((r, i) => {
      const geometry = r.geometry.coordinates.map(([lon, lat]) => [lon, lat] as LonLat);
      const annotated = r.legs.flatMap((l) => l.annotation?.duration ?? []);
      let offsets: number[];
      if (annotated.length === geometry.length - 1) {
        offsets = [0];
        for (const d of annotated) offsets.push(offsets[offsets.length - 1]! + d);
      } else {
        offsets = proportionalOffsets(geometry, r.duration);
      }
      const end = addSeconds(departure, r.duration);
      return {
        id: `${mode}-${i}`,
        mode,
        legs: [
          {
            mode,
            outdoor: false,
            startTime: toTokyoIso(departure),
            endTime: toTokyoIso(end),
            durationSec: r.duration,
            distanceM: r.distance,
            geometry,
            vertexOffsetsSec: offsets,
          },
        ],
        startTime: toTokyoIso(departure),
        endTime: toTokyoIso(end),
        durationSec: r.duration,
        distanceM: r.distance,
        walkingSec: 0,
        source: {
          provider: providerId,
          kind: "provider_route" as const,
          retrievedAt,
          attribution: "© OpenStreetMap contributors / OSRM",
          note: publicDemo ? "public_demo_endpoint" : undefined,
        },
      };
    });
}
