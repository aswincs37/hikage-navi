# Privacy and security notes

## Privacy
- No accounts, no database, no analytics, no tracking cookies.
- Search parameters, including coordinates, travel in the URL (so that searches are shareable and reproducible) and to the upstream providers listed in DATA_SOURCES. They are not stored server-side.
- "Recent searches" (up to 6 trips) are kept only in the browser's `localStorage` on the user's device and never sent to the server. When the origin was "current location", its coordinates are not saved (only the destination). Users can clear the list with "履歴を消す / Clear history".
- The last result is kept in the browser's `sessionStorage` for the details page, only for the tab's lifetime.
- Geolocation is requested **only** when the 「現在地を使う」 button is pressed. Coordinates are rounded to 5 decimals (about 1 m), and manual entry is always available.
- Server logs: API error logging records only the endpoint name and error class, never request bodies or coordinates (`internalError` in `src/lib/http/api.ts`). The hosting platform's access logs will still contain URLs with coordinates for page loads of `/search?...`. Review platform log retention, or move the query into a fragment if that matters for your deployment.
- IP addresses are used in memory for rate limiting only.

## Security
- All third-party calls are server-side. API keys (`OPEN_METEO_API_KEY`, `OTP_API_KEY`) never reach the browser, and `src/lib/config/env.ts` imports `server-only`.
- Input validation uses zod schemas. There's a coordinate range check, a Japan bounding box, a per-mode distance cap, a date window, a 256 KB body limit, list size limits, and a 100-character query limit.
- Errors return codes only, with no stack traces or upstream URLs.
- Upstream timeouts are configurable via `PROVIDER_TIMEOUT_MS` and `SHADE_TIMEOUT_MS`.
- Per-IP fixed-window rate limiting, in-process only.
- Security headers: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and a `Permissions-Policy` limiting geolocation to self. A CSP is not yet configured. If you add one, it must allow the GSI tile host, `blob:` workers, and `/vendor/maplibre-gl-worker.mjs`.
- Dependencies: `npm audit` reported 0 vulnerabilities at the pinned versions on 2026-10-28.

## Accessibility
- `lang="ja"`, skip link, labelled form controls, and fieldsets with legends.
- `aria-live` regions for loading, errors, and geocoding results; serious heat warnings use `role="alert"`.
- Warnings use a text level (【危険】/【警戒】…) plus an icon, not colour alone. The shade bar also shows numbers, and the map legend uses line styles as well as colours.
- The map has a text summary (`role="img"` with `aria-label`), and all map information is repeated in the tables on the details page.
- Visible focus rings and `prefers-reduced-motion` are respected.
