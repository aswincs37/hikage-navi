# Cost estimate

**No prices in this document were verified against official pricing pages during this work.** Every figure marked *unverified* must be checked on the provider's current pricing page before it's used in a budget.

## Development
| Item | Cost |
|---|---|
| Tooling (Node, Next.js, MapLibre, Vitest, etc.) | Free / open source |
| Data during development (demo endpoints) | Free, within fair-use limits |
| Developer time | The main cost; not estimated here |

## Operating, minimal (prototype / non-commercial pilot)
| Component | Option | Monthly cost |
|---|---|---|
| Hosting | Vercel Hobby / Cloudflare / Netlify free tiers | Free tier exists; **Vercel Hobby is non-commercial only**. Function duration limits matter, since a search can take 5–40 s when Overpass is slow (`maxDuration = 60` is set). *Unverified* |
| Map tiles | GSI tiles | Free with attribution |
| Weather | Open-Meteo free | Free, non-commercial only |
| WBGT | MoE CSV | Free (check terms) |
| Routing / buildings / geocoding | Public FOSSGIS OSRM, Overpass, Nominatim | Free but **not acceptable for a production service** under their policies |
| Database | none | 0 |

## Operating, small commercial production
| Component | Option | Estimated monthly cost |
|---|---|---|
| App hosting | Vercel Pro / similar | *Unverified* (roughly tens of USD per seat is typical; check) |
| OSRM car profile (Japan extract) | Self-hosted VM, one profile only (about a third of the earlier foot+bike+car estimate of 8–16 GB RAM, not measured) | *Unverified* VM pricing (e.g. Sakura, AWS, GCP Tokyo) |
| Overpass (Japan) or pre-processed PLATEAU/OSM buildings | Self-hosted VM, or static tiles on object storage | *Unverified* |
| Nominatim (Japan) | Self-hosted, or a commercial geocoder | *Unverified* |
| Weather | Open-Meteo commercial API plan | *Unverified*; see open-meteo.com/en/pricing |
| Transit timetables | ODPT (registration; per-operator terms) + OTP VM, or a commercial transit API for nationwide coverage | **Unknown**; commercial nationwide timetable licences are typically the largest cost item and require quotes |
| Rate limiting / WAF | Platform-provided | Often included; *unverified* |

## Scaling notes
- The heaviest upstream is the building query. Cache per route corridor (already 24 h in-process), and at scale pre-tile buildings so that no live Overpass is needed.
- In-process caches and the rate limiter are per instance. Use Redis (e.g. Upstash) if you need shared limits; the free tier is *unverified*.
- Weather calls are batched (one per search, multi-location) and cached for 30 min per URL.
