import type { LegMode, Place, RouteAlternative, RouteLeg } from "@/lib/domain/types";
import { decodePolyline, proportionalOffsets } from "@/lib/geo/geometry";
import { fetchJson, ProviderError } from "@/lib/http/fetch";
import { toTokyoIso, tokyoDateString, tokyoTimeString } from "@/lib/time/tokyo";
import type { TransitRoutingProvider } from "./types";

/**
 * OpenTripPlanner 2（GTFS GraphQL API）アダプター。
 *
 * 時刻表は OTP に読み込ませた GTFS / GTFS-JP データに由来する。このアプリ自身は時刻表を持たず、
 * OTP が返さない列車・バスを作り出すことはない。OTP が未設定の場合、鉄道・バスは「未対応」と表示する。
 */

const PLAN_QUERY = `
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $date: String!, $time: String!, $modes: [TransportMode], $n: Int) {
  plan(from: $from, to: $to, date: $date, time: $time, transportModes: $modes, numItineraries: $n) {
    itineraries {
      startTime endTime duration walkTime waitingTime walkDistance
      legs {
        mode startTime endTime duration distance transitLeg realTime
        from { name lat lon }
        to { name lat lon }
        route { shortName longName agency { name } }
        legGeometry { points }
      }
    }
  }
}`;

interface OtpLeg {
  mode: string;
  startTime: number;
  endTime: number;
  duration: number;
  distance: number;
  transitLeg: boolean;
  realTime?: boolean;
  from: { name?: string; lat: number; lon: number };
  to: { name?: string; lat: number; lon: number };
  route?: { shortName?: string; longName?: string; agency?: { name?: string } } | null;
  legGeometry?: { points?: string } | null;
}

interface OtpItinerary {
  startTime: number;
  endTime: number;
  duration: number;
  walkTime: number;
  waitingTime: number;
  walkDistance: number;
  legs: OtpLeg[];
}

export interface OtpPlanResponse {
  data?: { plan?: { itineraries?: OtpItinerary[] } | null };
  errors?: { message: string }[];
}

const MODE_MAP: Record<string, LegMode> = {
  WALK: "walk",
  BICYCLE: "cycle",
  RAIL: "rail",
  SUBWAY: "subway",
  TRAM: "tram",
  MONORAIL: "rail",
  FUNICULAR: "rail",
  BUS: "bus",
  COACH: "bus",
  TROLLEYBUS: "bus",
  FERRY: "ferry",
};

export class OtpTransitProvider implements TransitRoutingProvider {
  readonly id = "opentripplanner";
  constructor(
    private readonly url: string,
    private readonly http: { timeoutMs: number; userAgent: string },
    private readonly apiKey?: string,
  ) {}

  async plan(origin: Place, destination: Place, departure: Date, mode: "train" | "bus"): Promise<RouteAlternative[]> {
    const modes =
      mode === "train"
        ? [{ mode: "RAIL" }, { mode: "SUBWAY" }, { mode: "TRAM" }, { mode: "MONORAIL" }, { mode: "WALK" }]
        : [{ mode: "BUS" }, { mode: "WALK" }];
    const body = JSON.stringify({
      query: PLAN_QUERY,
      variables: {
        from: { lat: origin.lat, lon: origin.lon },
        to: { lat: destination.lat, lon: destination.lon },
        date: tokyoDateString(departure),
        time: tokyoTimeString(departure),
        modes,
        n: 5,
      },
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const data = await fetchJson<OtpPlanResponse>(this.url, { provider: this.id, method: "POST", body, headers, ...this.http });
    return normaliseOtp(data, mode, this.id);
  }
}

export function normaliseOtp(data: OtpPlanResponse, mode: "train" | "bus", providerId: string): RouteAlternative[] {
  if (data.errors?.length) throw new ProviderError("parse", providerId);
  const itineraries = data.data?.plan?.itineraries ?? [];
  const retrievedAt = new Date().toISOString();

  return itineraries
    .map((it, i): RouteAlternative | null => {
      const legs: RouteLeg[] = [];
      for (const l of it.legs) {
        let geometry = l.legGeometry?.points ? safeDecode(l.legGeometry.points) : [];
        if (geometry.length < 2) geometry = [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]];
        const legMode = MODE_MAP[l.mode] ?? "other_transit";
        legs.push({
          mode: legMode,
          outdoor: legMode === "walk" || legMode === "cycle",
          startTime: toTokyoIso(new Date(l.startTime)),
          endTime: toTokyoIso(new Date(l.endTime)),
          durationSec: l.duration,
          distanceM: l.distance,
          geometry,
          vertexOffsetsSec: proportionalOffsets(geometry, l.duration),
          fromName: l.from.name,
          toName: l.to.name,
          routeName: l.route ? (l.route.shortName || l.route.longName) : undefined,
          operatorName: l.route?.agency?.name,
          realtime: l.realTime,
        });
      }
      // 少なくとも1区間は鉄道・バスを含む経路のみ（徒歩のみの経路は徒歩モードで扱う）
      if (!legs.some((l) => !l.outdoor)) return null;
      const transitLegs = legs.filter((l) => !l.outdoor).length;
      return {
        id: `${mode}-${i}`,
        mode,
        legs,
        startTime: toTokyoIso(new Date(it.startTime)),
        endTime: toTokyoIso(new Date(it.endTime)),
        durationSec: it.duration,
        distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
        walkingSec: it.walkTime,
        transfers: Math.max(0, transitLegs - 1),
        waitingSec: it.waitingTime,
        source: { provider: providerId, kind: "provider_timetable", retrievedAt, attribution: "OpenTripPlanner / GTFS" },
      };
    })
    .filter((r): r is RouteAlternative => r !== null);
}

function safeDecode(points: string) {
  try {
    return decodePolyline(points);
  } catch {
    return [];
  }
}
