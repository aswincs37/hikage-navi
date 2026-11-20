# Deployment

**Nothing has been deployed.** These are instructions, not a record of a deployment.

## Any Node host
```bash
npm ci
npm run build        # runs scripts/copy-maplibre-worker.mjs first
npm start            # PORT env var or -p
```
Set environment variables from `.env.example`. Serve the app over HTTPS behind the platform or a reverse proxy.

## Vercel (example)
1. Import the repo, select the Next.js framework, and leave the build command as `npm run build`.
2. Add environment variables, at minimum `HTTP_USER_AGENT` with operator contact details, plus either self-hosted provider URLs or `ALLOW_PUBLIC_DEMO_ENDPOINTS=true` for a non-commercial pilot.
3. The search routes set `maxDuration = 60`. Check that your plan allows it.

## Self-hosted data services (recommended for production)
- **OSRM:** download the Japan extract from Geofabrik, run `osrm-extract`/`osrm-partition`/`osrm-customize` with `car.lua`, and run one `osrm-routed` instance. Set `OSRM_CAR_URL`.
- **Train network (default):** run `npm run rail:build` (fetches Japan railway tiles from Overpass, roughly 1–2 hours on the public server; resumable via `.cache/rail-tiles/`) and deploy `data/rail/japan-rail.json.gz` with the app. `next.config.ts` includes it in the build output. Rebuild occasionally to pick up OSM changes.
- **OpenTripPlanner 2:** build a graph from the Japan OSM extract plus the GTFS feeds you are licensed to use, then set `TRANSIT_PROVIDER=otp` and `OTP_GRAPHQL_URL=http://host:8080/otp/gtfs/v1`.
- **Overpass:** run your own instance with the Japan extract, or replace the shade provider with pre-processed building data.

## Production-readiness checklist
- [ ] Operator name and contact filled into `/privacy`, `/terms`, `/contact`; legal review done; draft banners removed
- [ ] Provider terms re-checked (Open-Meteo commercial plan, MoE WBGT usage, GSI, OSM/ODbL, timetable licences)
- [ ] No public demo endpoints in production (`ALLOW_PUBLIC_DEMO_ENDPOINTS` unset or false)
- [ ] `HTTP_USER_AGENT` identifies the operator
- [ ] Platform WAF / rate limiting enabled (in-process limiter is per instance)
- [ ] HTTPS enforced; security headers verified (set in `next.config.ts`)
- [ ] Error monitoring that does not log coordinates
- [ ] `npm run check` passes in CI
- [ ] Off-season WBGT behaviour reviewed (shows "out of season")
- [ ] Accessibility audit with a real screen reader (VoiceOver/TalkBack) and keyboard-only pass
- [ ] Load test of the search endpoint with the real providers
