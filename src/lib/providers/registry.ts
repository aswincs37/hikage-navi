import "server-only";
import { getConfig, type AppConfig } from "@/lib/config/env";
import type { ProviderNotice } from "@/lib/domain/types";
import { CompositeGeocoder, GsiGeocoder, NominatimGeocoder, PhotonGeocoder } from "./geocoding";
import { MoeWbgtProvider } from "./moeWbgt";
import { OpenMeteoProvider } from "./openMeteo";
import { OsrmRoutingProvider } from "./osrm";
import { OsmRailTransitProvider } from "./rail/osmRail";
import { OtpTransitProvider } from "./otp";
import { OverpassShadeDataProvider } from "./overpass";
import type {
  GeocodingProvider,
  ShadeDataProvider,
  StreetRoutingProvider,
  TransitRoutingProvider,
  WbgtProvider,
  WeatherProvider,
} from "./types";

export interface Providers {
  geocoder: GeocodingProvider | null;
  /** 入力中の候補表示用。Nominatim 公開版は入力補完での利用が禁止のため、Photon と国土地理院 */
  suggester: GeocodingProvider | null;
  street: { car: StreetRoutingProvider | null };
  transit: TransitRoutingProvider | null;
  weather: WeatherProvider | null;
  wbgt: WbgtProvider | null;
  shade: ShadeDataProvider | null;
  shadeMaxRouteKm: number;
  weatherMaxLeadDays: number;
  /** 設定状態（公開デモエンドポイント使用中など）の告知 */
  configNotices: ProviderNotice[];
}

export function buildProviders(config: AppConfig = getConfig()): Providers {
  const http = { timeoutMs: config.requestTimeoutMs, userAgent: config.userAgent };
  const notices: ProviderNotice[] = [];

  const geocoders: GeocodingProvider[] = [];
  if (config.geocoding.nominatim) geocoders.push(new NominatimGeocoder(config.geocoding.nominatim, http));
  const photon = config.geocoding.photon ? new PhotonGeocoder(config.geocoding.photon, http) : null;
  if (photon) geocoders.push(photon);
  const gsi = config.geocoding.gsi ? new GsiGeocoder(config.geocoding.gsi, http) : null;
  if (gsi) geocoders.push(gsi);
  const suggesters = [photon, gsi].filter((g): g is NonNullable<typeof g> => g !== null);

  const street = {
    car: config.routing.car ? new OsrmRoutingProvider("car", config.routing.car, http) : null,
  };
  if (Object.values(config.routing).some((e) => e?.publicDemo)) {
    notices.push({ provider: "osrm", capability: "routing", status: "demo_endpoint", messageCode: "routing_demo" });
  }

  const transit =
    config.transit?.provider === "otp"
      ? new OtpTransitProvider(config.transit.url, http, config.transit.apiKey)
      : config.transit?.provider === "osm-rail"
        ? new OsmRailTransitProvider(config.transit.file)
        : null;
  if (config.transit?.provider === "osm-rail") {
    notices.push({ provider: "osm-rail", capability: "transit", status: "partial", messageCode: "transit_estimated" });
  }
  if (!transit) notices.push({ provider: "transit", capability: "transit", status: "not_configured", messageCode: "transit_not_configured" });

  const weather = config.weather ? new OpenMeteoProvider(config.weather.endpoint, http, config.weather.apiKey) : null;
  if (config.weather?.endpoint.publicDemo) {
    notices.push({ provider: "open-meteo", capability: "weather", status: "demo_endpoint", messageCode: "weather_free_tier" });
  }

  const wbgt = config.wbgt
    ? new MoeWbgtProvider(config.wbgt.forecast, config.wbgt.stations, config.wbgt.maxStationDistanceKm, http)
    : null;
  const shade = config.shade ? new OverpassShadeDataProvider(config.shade.endpoint, { ...http, timeoutMs: config.shade.timeoutMs }) : null;
  if (config.shade?.endpoint.publicDemo) {
    notices.push({ provider: "osm-overpass", capability: "shade", status: "demo_endpoint", messageCode: "shade_demo" });
  }

  return {
    geocoder: geocoders.length > 0 ? new CompositeGeocoder(geocoders) : null,
    suggester: suggesters.length > 0 ? new CompositeGeocoder(suggesters, 6) : null,
    street,
    transit,
    weather,
    wbgt,
    shade,
    shadeMaxRouteKm: config.shade?.maxRouteKm ?? 5,
    weatherMaxLeadDays: config.weatherMaxLeadDays,
    configNotices: notices,
  };
}
