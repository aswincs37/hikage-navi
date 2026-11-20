# Methodology and limitations

The Japanese user-facing version is at `/how-it-works`.

## Four separate concepts

| Concept | How it's computed | `DataKind` |
|---|---|---|
| Astronomical solar position | astronomy-engine 2.1.19: `Equator(Sun)` then `Horizon()`. Geometric altitude (no refraction) decides "above horizon"; apparent altitude uses standard refraction. Observer altitude is 0 m | `astronomical` |
| Potential direct sunlight | Sun above horizon and the segment not estimated as shaded. **Clouds are not included**; cloud cover is shown separately | `estimate` |
| Estimated shade | Building-shadow ray test (below) | `modelled` |
| Observed sunlight | Not implemented | n/a |

## Segment sampling
1. Each leg comes from the provider with per-vertex time offsets. OSRM provides `annotations=duration` per edge; OTP legs are distance-proportional within the leg.
2. Legs are split into ≤ 20 m pieces (outdoor) or ≤ 200 m pieces (vehicle), then merged into ≈ 30 s (outdoor) or ≈ 60 s (vehicle) segments. The merge window widens so there are never more than 600 segments per leg.
3. The sun is computed at each segment's midpoint and mid-time.
4. Totals are reported in whole minutes. The shaded/exposed/unknown parts use largest-remainder rounding so they sum to the sun-up total. Nothing is reported to the second.

Relative sun side: angle from the travel bearing to the sun azimuth. Front is (−45°, 45°], right is (45°, 135°], left is [−135°, −45°), and the rest is back. "Overhead" means elevation ≥ 75°.

## Shade model (`src/lib/shade/engine.ts`)
- Buildings come from the OSM `building` / `building:part` features within a 200 m corridor of the outdoor route (Overpass).
- Height comes from the `height` tag (metres only). Otherwise it's `building:levels × 3 m`, flagged `levels_estimate` and lowering confidence. Otherwise the height is **unknown**.
- From each segment midpoint, a horizontal ray is cast toward the sun's azimuth, up to 200 m. A building at distance *d* with height *H* shades the point if *H* > *d*·tan(elevation). The ground is assumed flat.
- Classification:
  - **shaded**: a building of known height blocks the sun, or the point lies inside a footprint (station or arcade roof).
  - **unknown**: an unknown-height building lies on the ray; or there are no buildings within 100 m (missing data is not evidence of sun); or the sun is below 3°; or 200 m·tan(elevation) < 40 m, meaning a taller building beyond the corridor could still shade the point; or the route is longer than `SHADE_MAX_ROUTE_KM`; or the provider failed.
  - **exposed**: the ray found no obstruction. Trees, terrain, footbridges, and awnings are not modelled.
- For ranking, "minimise sun" uses `sunUpOutdoorMin − shadedMin`, which counts unknown minutes as possibly sunny. Missing shade data therefore never makes a route look better.

## Vehicle sides
For each non-outdoor segment with the sun up and elevation < 60°: if the sun is more than 10° away from straight ahead or straight behind, it has a sideways component and the segment counts toward that side (right if the sun is clockwise of the bearing, otherwise left); within ±10° of ahead/behind counts as front/back. This matters for low sun: driving west at 16:00 in November with the sun 20–30° front-left still lights the left windows, and the earlier 30°–150° rule discarded most of that time (e.g. Nagoya → Kyoto, 50 of 76 daylight minutes), producing a misleading "similar". The displayed minutes are the time with sun on each side; the recommendation compares side time **weighted by |sin(angle)|** (full weight abeam, small weight near the nose/tail). The shadier side is chosen only if the weighted total is ≥ 2 min and the sides differ by ≥ 20%; otherwise "similar". Map colouring of ride segments uses the same rule (`src/lib/solar/side.ts`). Subway legs are always "unknown". Clouds, trackside buildings, tunnels, and seat orientation are listed as caveats. Car results explicitly state that they are **not** a cabin-temperature prediction.

## Scope
Only road (car, bus) and train journeys can be searched. Walking and cycling are not offered: left/right advice needs a seat, and the heading changes at every corner. Walking legs inside train journeys (to and between stations) are still evaluated for sun and building shade.

## Estimated train routes (`src/lib/providers/rail/`)
- Network: OpenStreetMap passenger tracks (`railway=rail|subway|light_rail|monorail|narrow_gauge`, without `service=*` and without freight/industrial/military/tourism usage) and `railway=station|halt` nodes. Junctions and track ends become graph nodes; geometry between them is simplified to about 8 m.
- A station is attached to tracks within 150 m (60 m for high-speed lines, which pass many stations without stopping). When the station and nearby tracks have `operator` tags, it is attached only to tracks of the same operator (JR companies count as one), so e.g. JR tracks passing a Keikyu station do not stop there. Stations with the same name within 700 m are linked as a 5 min walking transfer.
- Boarding or alighting costs 150 s, so a transfer costs 5 min; the first train adds a 3 min wait. Boarding a high-speed line adds another 15 min in total (gates, lower frequency), so short trips prefer conventional lines.
- Average speeds including stops: high-speed lines 50 m/s (180 km/h), conventional 22 m/s (about 80 km/h, between local and rapid trains), subway 9 m/s, light rail/monorail 10 m/s.
- Origin and destination use stations within 1.5 km (3 km if none), with walking at 1.3 m/s × 1.25 detour on a straight line. A* finds the fastest path; rides shorter than 400 m are treated as part of a transfer.
- Seat side is then computed exactly as for other vehicles, from the track direction at each point and the estimated passing time. Subway legs are excluded as underground.
- Not modelled: actual train services and frequencies, express vs local stopping patterns, through-running, tunnels (sun is still counted inside them), fares.

## Weather alignment
- Query points are taken every max(10 min, duration/10) along the route, plus the endpoint. They're snapped to a 0.05° grid, which is comparable to the model grid, to batch requests. Each point is matched to the nearest hourly value within ±45 min; otherwise it's dropped.
- Nothing is queried if the journey is more than 7 days ahead (`WEATHER_MAX_LEAD_DAYS`) or more than 1 day in the past.
- WBGT: the nearest MoE station with data within 25 km and the nearest 3-hour slot within ±90 min. The whole file is rejected if it was issued more than 36 h ago (out of season).

## Ranking
`balanced` = duration 1, outdoor 0.5, sun 0.5. Each selected preference adds weight 2 to its metric. Metrics are min-max normalised among candidates (0 = best). A route missing a metric gets 1 (worst) and lists it in `metricsMissing`. Metrics missing for every route are dropped, and the preference is reported as not applied. The score is 100 × (1 − weighted cost), and is relative only. Heat warnings never feed into or come out of the score.

## Next steps that would materially improve accuracy
1. **Building heights:** use the MLIT Project PLATEAU 3D city models (LOD1 heights, many cities) as a ShadeDataProvider. Pre-load them into PostGIS or tiled files and check the licence terms per dataset.
2. **Trees:** OSM `natural=tree`/`tree_row`/`wood` with assumed crown sizes, or a canopy-height dataset. Track them as a separate shade reason.
3. **Terrain:** a GSI DEM for hill shading at low sun.
4. **Tunnels:** OSM `tunnel=yes` / `covered=yes` on railways and roads, to mark covered vehicle segments.
5. **Official UV:** the JMA UV index forecast product.
