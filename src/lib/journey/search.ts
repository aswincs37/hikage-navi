import type {
  EvaluatedRoute,
  JourneySearchResult,
  ProviderNotice,
  RouteAlternative,
  TransportMode,
} from "@/lib/domain/types";
import { ProviderError } from "@/lib/http/fetch";
import { rankRoutes } from "@/lib/ranking/rank";
import type { Providers } from "@/lib/providers/registry";
import { toTokyoIso } from "@/lib/time/tokyo";
import type { JourneyRequest } from "@/lib/validation/schemas";
import { buildShadeContext, evaluateRoutes, shiftRoute, type ShadeContext } from "./evaluate";

type SearchProviders = Pick<Providers, "street" | "transit" | "weather" | "wbgt" | "shade" | "shadeMaxRouteKm" | "weatherMaxLeadDays" | "configNotices">;

type FetchRoutesResult =
  | { status: "ok"; routes: RouteAlternative[] }
  | { status: "unsupported" | "provider_error"; routes: []; notice: ProviderNotice };

export async function fetchRoutes(req: JourneyRequest, providers: SearchProviders, departure: Date = req.departure): Promise<FetchRoutesResult> {
  const mode: TransportMode = req.mode;
  if (mode === "train" || mode === "bus") {
    if (!providers.transit || (providers.transit.modes && !providers.transit.modes.includes(mode))) {
      return {
        status: "unsupported",
        routes: [],
        notice: { provider: "transit", capability: "transit", status: "not_configured", messageCode: "transit_not_configured" },
      };
    }
    try {
      return { status: "ok", routes: await providers.transit.plan(req.origin, req.destination, departure, mode) };
    } catch (e) {
      return { status: "provider_error", routes: [], notice: routingError(providers.transit.id, "transit", e) };
    }
  }
  const p = providers.street.car;
  if (!p) {
    return {
      status: "unsupported",
      routes: [],
      notice: { provider: `routing-${mode}`, capability: "routing", status: "not_configured", messageCode: "routing_not_configured" },
    };
  }
  try {
    return { status: "ok", routes: await p.route(req.origin, req.destination, departure) };
  } catch (e) {
    return { status: "provider_error", routes: [], notice: routingError(p.id, "routing", e) };
  }
}

function routingError(provider: string, capability: "routing" | "transit", e: unknown): ProviderNotice {
  const timeout = e instanceof ProviderError && e.kind === "timeout";
  return { provider, capability, status: "unavailable", messageCode: timeout ? `${capability}_timeout` : `${capability}_error` };
}

export async function searchJourney(req: JourneyRequest, providers: SearchProviders, now: Date = new Date()): Promise<JourneySearchResult> {
  const notices: ProviderNotice[] = providers.configNotices.filter((n) =>
    req.mode === "train" || req.mode === "bus" ? n.capability !== "routing" : n.capability !== "transit",
  );
  const base = {
    request: {
      origin: req.origin,
      destination: req.destination,
      departure: toTokyoIso(req.departure),
      mode: req.mode,
      preferences: req.preferences,
    },
    generatedAt: new Date().toISOString(),
  };

  const fetched = await fetchRoutes(req, providers);
  if (fetched.status !== "ok") {
    // 経路が無い場合、気象・日陰に関する告知は無関係なので経路に関するものだけ返す
    const relevant = notices.filter((n) => n.capability === "routing" || n.capability === "transit");
    if (!relevant.some((n) => n.messageCode === fetched.notice.messageCode)) relevant.push(fetched.notice);
    return { ...base, status: fetched.status, routes: [], ranking: null, notices: relevant };
  }
  if (fetched.routes.length === 0) return { ...base, status: "no_routes", routes: [], ranking: null, notices };

  const evaluated = await evaluateRoutes(fetched.routes, buildShadeContext(fetched.routes, providers, notices), providers, notices, now);
  const ranking = rankRoutes(evaluated, req.preferences);
  const order = new Map(ranking.ranked.map((r) => [r.routeId, r.rank]));
  evaluated.sort((a, b) => (order.get(a.route.id) ?? 99) - (order.get(b.route.id) ?? 99));
  return { ...base, status: "ok", routes: evaluated, ranking, notices: dedupe(notices) };
}

function dedupe(notices: ProviderNotice[]): ProviderNotice[] {
  const seen = new Set<string>();
  return notices.filter((n) => {
    const k = `${n.capability}:${n.messageCode}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------- 出発時刻の比較

export interface DepartureOption {
  requestedTime: string;
  status: "ok" | "no_routes" | "unsupported" | "provider_error";
  /** 希望条件で1位になった候補（なければ null） */
  best: EvaluatedRoute | null;
  routeCount: number;
}

export interface DepartureComparison {
  options: DepartureOption[];
  /** 徒歩・自転車・自動車では経路を1回だけ取得し、時刻をずらして再計算する */
  durationsAreTimeIndependent: boolean;
  notices: ProviderNotice[];
}

export async function compareDepartures(
  req: JourneyRequest,
  times: string[],
  providers: SearchProviders,
  now: Date = new Date(),
): Promise<DepartureComparison> {
  const notices: ProviderNotice[] = [];
  const date = toTokyoIso(req.departure).slice(0, 10);
  const departures = times.map((t) => ({ t, at: new Date(`${date}T${t}:00+09:00`) }));
  const isTransit = req.mode === "train" || req.mode === "bus";

  // 経路は時刻に依存しない（OSRM）ため、最初の時刻で1回だけ取得する
  let streetRoutes: RouteAlternative[] | null = null;
  let streetShade: Promise<ShadeContext> | null = null;
  if (!isTransit) {
    const fetched = await fetchRoutes(req, providers, departures[0]!.at);
    if (fetched.status !== "ok") {
      notices.push(fetched.notice);
      return {
        options: departures.map(({ t }) => ({ requestedTime: t, status: fetched.status, best: null, routeCount: 0 })),
        durationsAreTimeIndependent: true,
        notices,
      };
    }
    streetRoutes = fetched.routes;
    streetShade = streetRoutes.length ? buildShadeContext(streetRoutes, providers, notices) : null;
  }

  const options: DepartureOption[] = [];
  for (const { t, at } of departures) {
    let routes: RouteAlternative[];
    let shade: ShadeContext | Promise<ShadeContext>;
    if (isTransit) {
      const fetched = await fetchRoutes(req, providers, at);
      if (fetched.status !== "ok") {
        notices.push(fetched.notice);
        options.push({ requestedTime: t, status: fetched.status, best: null, routeCount: 0 });
        continue;
      }
      routes = fetched.routes;
      shade = routes.length ? buildShadeContext(routes, providers, notices) : { model: null };
    } else {
      const shift = (at.getTime() - departures[0]!.at.getTime()) / 1000;
      routes = streetRoutes!.map((r) => shiftRoute(r, shift));
      shade = streetShade ?? { model: null };
    }
    if (routes.length === 0) {
      options.push({ requestedTime: t, status: "no_routes", best: null, routeCount: 0 });
      continue;
    }
    const evaluated = await evaluateRoutes(routes, shade, providers, notices, now);
    const ranking = rankRoutes(evaluated, req.preferences);
    const bestId = ranking.ranked[0]?.routeId;
    options.push({
      requestedTime: t,
      status: "ok",
      best: evaluated.find((e) => e.route.id === bestId) ?? null,
      routeCount: routes.length,
    });
  }
  return { options, durationsAreTimeIndependent: !isTransit, notices: dedupe(notices) };
}
