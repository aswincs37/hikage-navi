# Deployment

**Nothing has been deployed.** These are instructions, not a record of a deployment.

## Quick start (any Node host)
```bash
npm ci
npm run build        # runs scripts/copy-maplibre-worker.mjs first
npm start            # PORT env var or -p
```
Serve over HTTPS behind the platform or a reverse proxy. Node 20.9+ (CI uses 22).

## Settings (set as environment variables; see `.env.example`)

| Setting | Required? | What it does |
|---|---|---|
| `SITE_URL` | Yes | Public URL. Also builds the User-Agent sent to external services. |
| `SITE_OPERATOR_NAME`, `CONTACT_EMAIL` and/or `CONTACT_FORM_URL`, `LEGAL_COURT` | Yes | Shown on /terms, /privacy, /contact. |
| `LEGAL_REVIEWED=true` | Yes, after legal review | Removes the "draft" banner (only when operator + contact are also set). |
| `ALLOW_PUBLIC_DEMO_ENDPOINTS=true` **or** your own `OSRM_CAR_URL`, `NOMINATIM_URL`/`PHOTON_URL`, `OVERPASS_URL`, `OPEN_METEO_API_KEY`, `MOE_WBGT_FORECAST_URL` + `JMA_AMEDAS_TABLE_URL` | Yes (one or the other) | Without either, place search and car routes are off in production. Public servers are fine for a small pilot only. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RATE_LIMIT_SALT` | Recommended | Shared rate limit across instances (serverless). Falls back to per-instance counting. |

### Check the setup
- On start, the server logs `[hikage-navi] readiness ...` lines for anything missing (or `readiness: OK`).
- `GET /api/v1/providers/status` returns the same list as `readiness` (codes only, no URLs or keys). Empty list = ready.

## What production mode adds
- Security headers: CSP (only this site + GSI map tiles), HSTS, nosniff, frame-deny, referrer and permissions policy.
- Offline support: a service worker caches pages and scripts; the last 5 results are saved on the device.
- Server errors are logged without URL query strings (which contain coordinates); hook an error tracker into `src/instrumentation.ts` (`onRequestError`) if needed.
- Compression is done by `next start` (Next.js 16.4.6+) or the host; the API does not compress by itself.

## Vercel (example)
1. Import the repo, framework Next.js, build command `npm run build`.
2. Add the settings above.
3. The search routes set `maxDuration = 60`. Check that your plan allows it.
4. Check `/api/v1/providers/status` after the first deploy.

## Free public services: limits and commercial use
With `ALLOW_PUBLIC_DEMO_ENDPOINTS=true` the app calls free public servers. `src/lib/http/publicServiceGate.ts` keeps the whole site (all server instances together, via Upstash Redis) under each service's published limits:

| Service | Site-wide limit in the app | Published policy |
|---|---|---|
| Nominatim | 1 request / 1.1 s, gives up after 4 s of queueing | max 1 request/s, no autocomplete |
| Overpass (overpass-api.de) | 1 request / s, 9,000 / day | under 10,000 queries/day |
| Open-Meteo (free) | 500 / min, 4,500 / hour, 9,000 / day | 600 / min, 5,000 / hour, 10,000 / day, **non-commercial only** |
| Photon, FOSSGIS OSRM | 120 / min | fair use |

When a limit is reached the request is not sent; that feature shows as temporarily unavailable. Without Upstash the limits are counted per server instance only. Calls to your own servers (any other host name) are not limited.

**Before any commercial use** (ads, paid plans, use inside a company): the Open-Meteo free API and the Vercel Hobby plan are both non-commercial only. Set `OPEN_METEO_API_KEY` (paid plan), move to Vercel Pro (or another host), and replace the other public servers with paid or self-hosted ones (next section).

## CI
`.github/workflows/ci.yml` runs `npm audit` (high+), type check, lint, tests (including the rail time benchmarks) and a production build on every push and pull request.

## Self-hosted data services (recommended for production)
- **OSRM:** download the Japan extract from Geofabrik, run `osrm-extract`/`osrm-partition`/`osrm-customize` with `car.lua`, and run one `osrm-routed` instance. Set `OSRM_CAR_URL`.
- **Train network (default):** run `npm run rail:build` (fetches Japan railway tiles from Overpass, roughly 1–2 hours on the public server; resumable via `.cache/rail-tiles/`) and deploy `data/rail/japan-rail.json.gz` with the app. `next.config.ts` includes it in the build output. Rebuild occasionally to pick up OSM changes.
- **OpenTripPlanner 2:** build a graph from the Japan OSM extract plus the GTFS feeds you are licensed to use, then set `TRANSIT_PROVIDER=otp` and `OTP_GRAPHQL_URL=http://host:8080/otp/gtfs/v1`.
- **Overpass:** run your own instance with the Japan extract, or replace the shade provider with pre-processed building data.

## Production-readiness checklist
- [ ] `SITE_URL`, operator, contact and court set; legal review done; `LEGAL_REVIEWED=true`
- [ ] Provider terms re-checked (Open-Meteo commercial plan, MoE WBGT usage, GSI, OSM/ODbL, timetable licences)
- [ ] Data providers configured (self-hosted, or `ALLOW_PUBLIC_DEMO_ENDPOINTS=true` for a small pilot)
- [ ] Shared rate limit (Upstash) or platform WAF rate limiting enabled
- [ ] `/api/v1/providers/status` shows an empty `readiness` list (or only accepted warnings)
- [ ] HTTPS enforced
- [ ] Error monitoring connected in `src/instrumentation.ts` (must not log coordinates)
- [ ] CI green
- [ ] Off-season WBGT behaviour reviewed (shows "out of season")
- [ ] Accessibility audit with a real screen reader (VoiceOver/TalkBack) and keyboard-only pass
- [ ] Load test of the search endpoint with the real providers
