# Feature status

Status labels:

- **Tested**: implemented and covered by automated tests (and, where noted, checked live on 2026-10-28).
- **Config-dependent**: implemented, but needs external configuration or credentials to work.
- **Partial**: partially implemented; see the notes column.
- **Not implemented**

| Feature | Status | Notes |
|---|---|---|
| Japanese UI, mobile-first layout, dark mode | Tested | UI tests cover the form; layout checked at 390 px (no horizontal overflow) and 1366 px via headless Edge |
| i18n architecture | Partial | All UI strings live in `src/lib/i18n/ja.ts`, and the engine returns codes only. There is no English catalogue or locale switch yet |
| Place search (GSI + Nominatim) | Config-dependent | Uses the public endpoints in dev (checked live). Production needs `ALLOW_PUBLIC_DEMO_ENDPOINTS=true` or self-hosted endpoints |
| Current location (button-only) | Tested in code; browser permission not automated | Requested only when the button is pressed; there is manual entry as an alternative |
| Walking / cycling routes | Removed | Only road (car, bus) and train can be searched. Walking legs inside train journeys are still evaluated |
| Car routes | Config-dependent | OSRM car profile, checked live. No traffic; durations don't vary with time of day |
| Train routes (estimated) | Implemented, tested | Default. Shortest-time path along OpenStreetMap passenger railway tracks between stations near the origin and destination (`src/lib/providers/rail/`). Times come from average speeds per track type plus fixed wait/transfer times, **not a timetable**, and are labelled as approximate. Seat side uses the real track direction. Unit tests on a synthetic network; checked live Kyoto → Osaka |
| Train / bus routes with timetables | Config-dependent | OpenTripPlanner adapter (`TRANSIT_PROVIDER=otp`), tested with fixtures. Bus routes are only available this way |
| Solar position engine | Tested | astronomy-engine, cross-checked against an independent NOAA formula to < 0.5° |
| Segment-level sun exposure | Tested | ~30 s outdoor / ~60 s vehicle resolution; minutes only (no false precision) |
| Train/car left-right sun side | Tested | Segment-wise on curved geometry. Tunnels aren't modelled; subway legs are reported as "unknown". Car results carry a glazing/cabin disclaimer |
| Shade estimation (building shadows) | Tested + config-dependent | Ray test against OSM buildings with heights. Missing heights or data give "unknown", never "sunny". The public Overpass server was slow (28–40 s) and later unresponsive during testing; the app degraded to "unknown" with a notice as designed |
| Tree / terrain shade | Not implemented | The interface has states for it; datasets were not integrated (see METHODOLOGY) |
| Weather along route (temp, RH, wind, cloud, precip prob.) | Config-dependent | Open-Meteo, multi-point and time-aligned (±45 min), checked live. Labelled as a model forecast, not an official JMA forecast |
| UV index | Config-dependent | Open-Meteo model UV, labelled as such. The official JMA UV product is not integrated |
| Official WBGT forecast | Config-dependent | MoE CSV plus JMA station table. Out-of-season / stale (>36 h) data is rejected: live on 2026-10-28 the latest issue was 2026-10-22, so it correctly reported "out of season". WBGT is never derived from temperature/humidity |
| Heat & UV warnings | Tested | Independent of ranking; text plus icon plus level label (not colour alone) |
| "Quick answer" card (seat side / sun minutes) | Tested | Results open with one headline: which seat to take (car/train) or minutes of possible sun (walking legs of train journeys), plus a top-down seat diagram. Conflicting legs give "changes along the way"; when the shade is unknown it says so and never claims "little sun" |
| Map colouring by sun side (vehicles) | Implemented | Ride segments are coloured by which side of the vehicle the sun is on (left = orange, right = purple, with text in the legend). Subway legs and night are not coloured. Manually verified at 390 px |
| Mobile-first form | Tested | Only the two places are required. Departure defaults to "leave now", preferences are collapsed, the submit button is fixed at the bottom of the screen, and the example routes scroll sideways. Inputs are at least 16 px to avoid iOS zoom-on-focus, and touch targets are at least 40 px |
| Add to home screen (PWA manifest) | Implemented | `app/manifest.ts` with the SVG icon, plus `viewport-fit=cover` and safe-area padding. There is no service worker or offline mode |
| As-you-type place suggestions | Tested | No search button. Suggestions appear as you type (after a 300 ms pause, ≥ 2 chars) from Photon (place names, stations, facilities; understands romaji such as "kyoto") plus GSI addresses, with a detail line (prefecture/city/ward) and a station badge. Duplicates (same name nearby, e.g. one station on several lines) are merged. Nominatim is used only on Enter or the "search stations & places" row, as its policy forbids autocomplete |
| Recent searches chips | Tested | The chip row above the form shows the last 6 searches (localStorage, this device only) instead of the fixed examples; the examples show only when there is no history. Current-location origins are not stored, so the chip fills only the destination |
| Route ranking with preferences | Tested | Min-max normalised weights. A route missing a metric is ranked as worst on it; preferences without data are listed as not applied |
| Recommendation explanation | Tested | Shown only for meaningful differences (≥ 2 min, ≥ 10 pts, ≥ 1 transfer) |
| "Scenic" preference | Not implemented | Always reported as "no data" |
| Departure-time comparison | Tested | Street modes reuse one route and shift times; transit queries the provider for each time |
| Route details page | Implemented | Segment table, weather timeline, WBGT, sources, confidence, limitations. Manually verified; no automated test |
| Break / rest-spot suggestions ("where can I take a break") | Not implemented | Would need a POI source (e.g. OSM amenities) plus opening-hours handling |
| Outdoor time before/after a car trip | Not implemented | Shown as not modelled (parking location unknown) |
| Observed actual sunlight | Not implemented | No suitable observational dataset integrated |
| REST API v1 | Tested (via orchestrator tests) + live smoke test | See API.md. `GET /journeys/{id}` was intentionally not built (no persistence) |
| Rate limiting | Implemented | In-memory per IP. Not shared across serverless instances; use a platform WAF in production |
| Legal pages (privacy, terms, contact) | Partial | Clearly marked **draft**; operator details are placeholders |
| Deployment | Not implemented | Nothing was deployed. See DEPLOYMENT.md |
