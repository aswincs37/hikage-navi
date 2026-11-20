# ひかげナビ (Hikage Navi)

A Japanese-first, mobile-first web app for comparing journeys in Japan by **outdoor time, potential direct sunlight, estimated shade, weather, UV and official heat-index (WBGT) forecasts**.

The core rule: measured, forecast, calculated, and unknown values are always kept apart and labelled. Missing data stays missing. Nothing is fabricated, including timetables, weather, building heights, and shade.

| Doc | Contents |
|---|---|
| [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) | Every feature labelled implemented / config-dependent / partial / not implemented |
| [docs/API.md](docs/API.md) | REST endpoints and response schemas |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Sun, exposure, shade, ranking maths and their limits |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | Providers, coverage, licences, limits, credentials |
| [docs/COSTS.md](docs/COSTS.md) | Development and operating cost estimate |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment and production-readiness checklist |
| [docs/PRIVACY_SECURITY.md](docs/PRIVACY_SECURITY.md) | Privacy and security notes |

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript (strict) + Tailwind CSS 4. It is a single app: the server route handlers are the backend. There is no separate Python service and no database, because nothing needs to be stored.
- **MapLibre GL JS 6**, using GSI pale raster tiles (地理院タイル) as the base map.
- **astronomy-engine** for solar position.
- **zod** for input validation, and **Vitest** with Testing Library for tests.

Why no Python/FastAPI or PostGIS: all geometry here runs over a few hundred points per route. That's simple planar maths in TypeScript, and a second service would add cost and deployment complexity without benefit. PostGIS becomes worthwhile only if you pre-load building/canopy data nationally (see METHODOLOGY → "Next steps").

## Run locally

Requirements: Node.js ≥ 20.9 (developed on Node 20.17).

```bash
npm install          # the author used --ignore-scripts; no package needs install scripts
cp .env.example .env.local   # optional; all settings are optional in development
npm run dev          # http://localhost:3000
```

In development the app automatically uses the public demo endpoints (OSRM FOSSGIS, Overpass, Open-Meteo free, Nominatim, GSI, MoE WBGT CSV). Train and bus searches return "unsupported" until you configure an OpenTripPlanner instance (see DATA_SOURCES).

```bash
npm test             # 103 unit/integration/UI tests (fixtures only; no network)
npm run typecheck
npm run lint
npm run build && npm start
npm run check        # all of the above
npm run rail:build   # (once) build data/rail/japan-rail.json.gz for train routes
```

`predev`/`prebuild` copy MapLibre's web worker into `public/vendor/` (`scripts/copy-maplibre-worker.mjs`). MapLibre 6 locates its worker relative to `import.meta.url`, which doesn't survive bundling; without this copy, route lines never render.

## Project layout

```
src/lib/domain        normalised types (DataKind, Maybe<T>, RouteAlternative, …)
src/lib/solar         solar position + segment exposure + train/car side estimate
src/lib/shade         building-shadow ray model
src/lib/ranking       transparent weighted ranking
src/lib/heat          heat/UV warnings (independent of ranking)
src/lib/providers     adapters: GSI, Nominatim, OSRM, OpenTripPlanner, Open-Meteo, MoE WBGT, Overpass
src/lib/journey       orchestration: search, departure-time comparison
src/lib/i18n          Japanese message catalogue (add en.ts for English)
src/app/api/v1        REST API
src/app, src/components  UI
tests/                Vitest suites
```
