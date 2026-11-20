# Data sources and provider notes

Terms change. **Re-read each provider's current terms before production use.** "Verified" below means the endpoint was reachable and returned the described format on 2026-10-28. It does **not** mean the licence terms were legally reviewed.

| Capability | Default provider | Adapter | Fields | Coverage | Update | Credentials | Limits / terms (summary, must re-check) |
|---|---|---|---|---|---|---|---|
| Base map | GSI 地理院タイル (pale) | `RouteMap.tsx` | raster tiles z2–18 | Japan | ongoing | none | Attribution "地理院タイル" required. Heavy commercial use may require notifying GSI |
| Geocoding (addresses) | GSI 住所検索 API | `GsiGeocoder` | title, lon/lat | Japan | n/a | none | No SLA. The app filters fuzzy matches by bigram similarity |
| Geocoding (POIs/stations) | Nominatim (OSMF) | `NominatimGeocoder` | name, lat/lon, category | global (`countrycodes=jp`) | ~daily | none | Public server: ≤ 1 req/s, no autocomplete, valid UA. Self-host for production volume. ODbL |
| Geocoding (as-you-type) | Photon (komoot, OSM data) | `PhotonGeocoder` | name, lat/lon, osm_key/value, district/city/state | Japan bbox | OSM-based | none | Built for search-as-you-type; understands romaji ("kyoto"). Public photon.komoot.io is fair-use only, so self-host (`PHOTON_URL`) for production volume. ODbL |
| Road (car, bus) routing | OSRM on routing.openstreetmap.de (FOSSGIS) | `OsrmRoutingProvider` | geometry, distance, duration, per-edge duration | global | weekly-ish | none | Demo service for light, non-commercial use and no SLA. **Self-host OSRM** (Geofabrik Japan extract, car profile) for production |
| Train (estimated, default) | OpenStreetMap railway tracks and stations, fetched once via Overpass by `scripts/build-rail-network.mjs` into `data/rail/japan-rail.json.gz` | `OsmRailTransitProvider` | track geometry, track type (high-speed / conventional / subway / light rail), line names, station names | Japan (rough land tiles) | when the file is rebuilt | none | ODbL: attribute "© OpenStreetMap contributors"; the network file is a derived database, so if it is distributed it must be offered under ODbL. Sidings, yards and freight-only lines are excluded. No timetable: which trains actually run, through-running and exact times are not known |
| Train/bus | OpenTripPlanner 2 (you host) | `OtpTransitProvider` | itineraries, legs, times, polylines, transfers, waiting | wherever you load GTFS | per feed | GTFS licences | GTFS/GTFS-JP: many operators publish via ODPT (公共交通オープンデータセンター), which requires developer registration and per-operator terms. Several major JR and private rail timetables are **not** openly licensed. Nationwide coverage usually means a commercial licence (e.g. NAVITIME/Jorudan/Val Mobility APIs); pricing not verified |
| Weather + UV | Open-Meteo forecast API | `OpenMeteoProvider` | temperature_2m, relative_humidity_2m, wind_speed_10m, cloud_cover, precipitation_probability, uv_index (hourly) | global; JMA models over Japan via best_match | hourly model runs | free: none; commercial: API key | Free API is **non-commercial** with a daily call cap. Commercial use needs a paid plan (`OPEN_METEO_API_KEY`). CC BY 4.0 attribution. Values are model output, not official JMA forecasts |
| Official WBGT forecast | MoE 熱中症予防情報サイト `prev15WG/dl/yohou_all.csv` | `MoeWbgtProvider` | WBGT×10 every 3 h, issue time, station id | ~840 stations | several times daily, **late April to late October only** | none | Data download offered by MoE. Check the site's usage conditions for redistribution and commercial use. The file isn't refreshed off-season (last issue seen: 2026-10-22) |
| WBGT station locations | JMA `bosai/amedas/const/amedastable.json` | `parseAmedasTable` | lat/lon (deg, min), name | AMeDAS stations | rarely | none | Not a documented API and may change. JMA web content is generally under the 政府標準利用規約 with attribution |
| Buildings for shade | Overpass API (overpass-api.de) | `OverpassShadeDataProvider` | footprints, height, building:levels | global; height tags sparse in Japan (0/14 near Tokyo Stn, 71/102 near Shibuya in a sample) | minutes | none | Public instance is fair-use (and was slow or unresponsive during testing). ODbL attribution; derived databases must follow share-alike. Self-host Overpass or pre-load PLATEAU for production |

## Caching

All caches are in-process and time-limited, never persisted:

| Data | TTL |
|---|---|
| Geocoding | 24 h |
| Weather | 30 min |
| WBGT CSV | 30 min |
| Station table | 24 h |
| Buildings | 24 h |

Check that each provider's terms permit these TTLs; OSM data is ODbL, which allows caching with attribution.

## Fixtures
Tests use synthetic fixtures shaped like real responses (`tests/*.test.ts`). They're never served by the app; there is no "demo data" mode.
