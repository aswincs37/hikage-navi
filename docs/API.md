# API v1

All endpoints are Next.js route handlers under `/api/v1`. JSON in, JSON out, times in ISO 8601.

Local times without an offset (`2026-07-01T09:00`) are interpreted as **Asia/Tokyo**. Japan uses a fixed UTC+09:00 offset with no DST.

Errors always have this shape (no stack traces, no upstream URLs or keys):

```json
{ "error": { "code": "invalid_request", "issues": [{ "field": "destination", "code": "same_place" }] } }
```

| HTTP | code | Meaning |
|---|---|---|
| 400 | `invalid_json`, `invalid_request`, `invalid_query` | Validation failure; `issues[].code` e.g. `outside_japan`, `same_place`, `too_far_for_mode`, `invalid_datetime`, `too_far_past` (>24 h ago), `too_far_future` (>30 days) |
| 413 | `payload_too_large` | Body > 256 KB |
| 429 | `rate_limited` | Per-IP budget (`RATE_LIMIT_PER_MINUTE`) exceeded; see `Retry-After` |
| 502/503 | `geocoding_error`, `geocoding_timeout`, `geocoding_not_configured` | Geocoder problems |
| 500 | `internal_error` | Unexpected failure |

Upstream failures during a journey search do **not** produce HTTP errors. The search returns `status` and `notices[]` so that partial results (for example sun calculations without weather) stay usable.

## `GET /api/v1/geocode?q=<1–100 chars>[&mode=suggest]`
Returns `{ query, results: [{ lat, lon, label, category?, source }] }`.
- Without `mode`: GSI + Nominatim (addresses, stations, facilities). Call it only on explicit user action (Enter / "search stations & places"); Nominatim's policy forbids autocomplete.
- `mode=suggest`: Photon + GSI (never Nominatim), used for as-you-type suggestions (client waits 300 ms after typing stops, ≥ 2 chars, aborts stale requests). Up to 6 results. Separate rate-limit bucket and cache.
- `lang=ja|en` (default `ja`): place names and the `detail` line (e.g. 京都府京都市南区 / Minami Ward, Kyoto Prefecture) in that language where the provider has them.

## `POST /api/v1/journeys/search`
```json
{
  "origin": { "lat": 35.65833, "lon": 139.69957, "label": "渋谷駅" },
  "destination": { "lat": 35.66521, "lon": 139.71226, "label": "表参道駅" },
  "departure": "2026-10-29T12:00",
  "mode": "train | bus | car",
  "preferences": ["balanced","minimise_sun","prefer_shade","minimise_outdoor","minimise_time","reduce_walking","fewer_transfers","scenic"]
}
```
Response `JourneySearchResult` (types in `src/lib/domain/types.ts`):

- `status`: `ok | no_routes | unsupported | provider_error`
- `routes[]`: `EvaluatedRoute`, sorted by rank. Each contains:
  - `route`: legs with geometry, per-vertex time offsets, and a `source.kind` of `provider_route` or `provider_timetable`
  - `segments[]`: per-segment time, bearing, `sun` (azimuth/elevation/aboveHorizon), `relativeSun`, and `shade { state: shaded|exposed|unknown|night, reason }`
  - `exposure`: minutes `outdoorMin`, `sunUpOutdoorMin`, `potentialSunMin`, `shadedMin`, `unknownShadeMin` (parts sum to `sunUpOutdoorMin`), plus `shadeCoverage`, `resolutionSec`, and `method` (library, inputs, missingInputs, assumptions, sources, confidence)
  - `vehicleSides[]`: per non-outdoor leg, left/right minutes, `shadierSide`, `caveats`
  - `weather`: `samples` and `wbgt` are each `Maybe<…>`, i.e. `{status:"available", value, source}` or `{status:"unavailable", reason, detail?}`. Aggregates are `temperatureRangeC`, `maxUvIndex`, `maxPrecipitationProbabilityPct`, `meanCloudCoverPct`, `maxWbgt`
  - `heatWarnings[]`: `{ level: danger|warning|caution|info, code, value?, validTime?, source? }`
- `ranking`: `ranked[] { routeId, rank, score (0–100, relative; null if not comparable), metricsUsed, metricsMissing, reasons[] }`, plus `appliedPreferences`, `ignoredPreferences[{preference, reason: no_data|not_applicable}]`, `weights`
- `notices[]`: `{ provider, capability, status, messageCode }`, e.g. `routing_demo`, `transit_not_configured`, `weather_too_far`, `wbgt_out_of_season`, `shade_timeout`

## `POST /api/v1/journeys/departures`
The search body plus `"times": ["09:00","13:00"]` (1–8, same date as `departure`). Returns `{ options[{requestedTime, status, best: EvaluatedRoute|null (segments omitted), routeCount}], durationsAreTimeIndependent, notices }`. Rate-limit weight equals the number of times.

## `POST /api/v1/sun/position`
`{ "lat": 35.68, "lon": 139.77, "datetime": "2026-06-21T11:43" }` returns `{ position: { azimuthDeg, elevationDeg, apparentElevationDeg, aboveHorizon }, source }`.

## `POST /api/v1/exposure/calculate`
`{ geometry: [[lon,lat],…] (2–5000), departure, durationSec, mode: car|rail|bus }` returns `{ segments, exposure, vehicleSides, notices }`. Time is distributed along the line in proportion to distance.

## `POST /api/v1/weather/route`
`{ points: [{ lat, lon, time }] }` (1–24 points within Japan) returns `{ weather: (WeatherSample|null)[] | {error}, wbgt: Maybe<…> | {error} }`.

## `GET /api/v1/providers/status`
Returns which capabilities are `configured`, `demo_endpoint`, or `not_configured`. It returns no URLs or keys, and makes no upstream calls.

### Not implemented
`GET /api/v1/journeys/{id}`: results aren't persisted (privacy and zero infrastructure). The search URL itself reproduces a search, and the browser keeps the last result in `sessionStorage` for the details page.
