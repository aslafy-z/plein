# Study — a cached-data backend with the client as its own fallback

Status: study, September 2026. Nothing in this document is built. It sizes
the idea, prices it, compares the storage options and says how much of the
existing code carries over. Every number marked « measured » was taken on
2026-09-17 from the four live upstreams with the app's own parsers (see
« How the numbers were obtained »); every price comes from the providers'
own pricing pages on the same day and will drift.

## 1. The idea in one paragraph

Today every device talks to four governments' APIs directly (plus OSRM,
Valhalla and three geocoders). The proposal is a small backend of our own
that holds a fresh copy of the station data and answers the app in one
round-trip, with the app keeping its current direct-to-upstream code as
the fallback: when the backend is slow, down or in maintenance, the same
providers that run today take over, unchanged, and the user sees the same
screens. The backend is an accelerator and a cost-shifter, never a
dependency.

## 2. What the app does today (measured)

| Source | What one client fetch asks for | One fetch | Whole country | Stations | Upstream refresh | Client timeout |
| --- | --- | --- | --- | --- | --- | --- |
| France (ODS, data.economie.gouv.fr) | a 25 km circle, pages of 100, capped at 300 | 46 KB gz (288 KB raw) per page, 1.2–1.4 s | JSON export 4.5 MB gz (29 MB raw) in 1.2 s; roulez-eco zip 0.9 MB (12 MB XML) | 9,804 records, 9,442 with a price and coordinates | every 10 min; the ODS mirror answers `cache-control: max-age=300` | 9 s |
| Spain (MITECO REST) | one province (52), memoized 30 min | Madrid 0.94 MB, 2.6 s | 12.2 MB, 17 s | 11,468 | ~30 min (one `Fecha` stamp for the whole file) | 15 s |
| Portugal (DGEG REST) | one district (18), memoized 30 min | 87–793 KB, 0.7–1.4 s | 5.3 MB over 18 calls | 3,138 (14,221 station × product rows) | over the day | 15 s |
| Andorra (ArcGIS FeatureServer) | the whole country, memoized 30 min | 22 KB gz (176 KB raw), 1.2 s | same | 54 (275 rows) | over the day | 15 s |

Two facts about the French mirror matter for a backend: it rate-limits at
50,000 calls per day per IP (`x-ratelimit-limit`, reset at midnight UTC),
and one full-country export costs a single call. A poller at one call every
10 minutes spends 144 of those 50,000.

What the app keeps per area, once normalized to its own `Station` shape
(this is what lands in IndexedDB and what a backend would serve):

| 25 km area | Stations | Raw JSON | gzip | brotli |
| --- | --- | --- | --- | --- |
| Toulouse | 127 | 92 KB | 10.6 KB | 8.1 KB |
| Paris | 493 | 400 KB | 40 KB | 27 KB |
| Madrid | 655 | 450 KB | 35 KB | 25 KB |
| Lisbon | 368 | 169 KB | 24 KB | 18 KB |
| Lozère (rural) | 18 | 14 KB | 2.3 KB | 2.0 KB |

The French zone also pulls `/brands-fr.json` (292 KB, service-worker
cached) to give gouv stations a brand and a snapped position.

How much the prices actually move (what an ingester would have to write):

- France: 17,270 of 31,831 price cells carried an update stamp under 24 h
  old, 4,217 under one hour (a weekday morning). Call it 15–20k changed
  cells a day, a few hundred per 10-minute cycle at peak.
- Spain: two full downloads seven minutes apart differed in zero price
  values. The flux moves on its ~30-minute cycle and stamps the whole file,
  not each price.
- Portugal and Andorra: a few thousand and a few dozen stations; noise.

## 3. What « the whole thing » weighs

| | Stations | Raw JSON (app shape) | gzip | brotli |
| --- | --- | --- | --- | --- |
| France | 9,442 | 7.5 MB | 883 KB | 529 KB |
| Spain | 11,468 | 8.9 MB | 749 KB | 491 KB |
| Portugal | 3,138 | 1.5 MB | 203 KB | 141 KB |
| Andorra | 54 | 34 KB | 2.9 KB | 2.3 KB |
| **All four** | **24,102** | **17.9 MB** | **1.8 MB** | **1.2 MB** |
| Prices only (id + prices) | 24,102 | 5.2 MB | 400 KB | 270 KB |

So the live dataset is small by any database's standard: 24k rows, 69k
price cells, 18 MB uncompressed. It fits in the memory of a single Worker
isolate (128 MB), in every free storage tier below, and as a single object
in Workers KV (25 MiB value ceiling). Storage is not where the cost is;
**write frequency and read fan-out are.**

A price **history**, which none of the upstreams offer and which a backend
makes possible, grows at roughly 20k changed cells a day across the four
countries. At ~40 bytes a row that is under 1 MB a day, ~25 MB a month,
~300 MB a year — still inside every 5 GB free tier for years. It is the one
feature that needs a real database; the cache itself does not.

## 4. Two ways to serve it

### 4.1 « Price tiles »: static files, no query engine

Partition the normalized stations on the same XYZ grid the basemap uses
and publish one JSON file per non-empty tile, rewritten every cycle. The
client asks for the handful of tiles that cover its 25 km circle exactly
as it asks for map tiles, filters the circle locally (it already does: the
French provider filters `within_distance` results, the Spanish one filters
a whole province). No request ever runs code on the backend; the edge
cache absorbs the fan-out.

Measured on the real dataset (the whole four-country set, per zoom):

| Zoom | Tiles with stations | Largest tile | Median tile | Total brotli | Tiles for a 25 km circle (Toulouse / Paris / Madrid / Lisbon) | Bytes for it |
| --- | --- | --- | --- | --- | --- | --- |
| z7 (~300 km) | 47 | 1,439 st, 65 KB br | 446 st, 26 KB | 1.27 MB | 1 / 2 / 1 / 2 | 43 / 108 / 63 / 63 KB |
| z8 (~150 km) | 137 | 1,066 st, 42 KB br | 115 st, 8.4 KB | 1.37 MB | 2 / 2 / 1 / 2 | 27 / 56 / 42 / 46 KB |
| **z9 (~75 km)** | **445** | **441 st, 25 KB br** | **29 st, 2.9 KB** | **1.61 MB** | **4 / 4 / 4 / 4** | **20 / 49 / 46 / 35 KB** |
| z10 (~38 km) | 1,572 | 401 st, 16 KB br | 6 st, 1.1 KB | 2.14 MB | 4 / 5 / 5 / 5 | 13 / 25 / 32 / 17 KB |

z9 is the sweet spot: an area costs four small requests and 20–50 KB,
about what one ODS page costs today, for a complete answer (no 300-station
cap, brands already applied). A write cycle touches at most 445 objects,
and only the tiles whose content changed need rewriting (a content hash
per tile makes that a comparison, not a guess).

What this option cannot do: answer « these 12 ids » (favorites) or « along
this polyline » (route corridor) in one request. Favorites are covered by
fetching their tiles (a favorite list spans a few tiles); the corridor of
a 700 km trip crosses ~20 z9 tiles, 200–500 KB, heavier than today's
sampled ODS queries (≤ 1,000 stations) but still one screen of map tiles.
Both can stay on the upstream path in a first phase.

### 4.2 A query API: something runs per request

A Worker (or a VPS) that holds the dataset and answers `near`, `along`
and `byIds` queries, plus history. It is the natural home for the corridor
and for favorites, and the only home for history. It costs CPU per
request and puts a database in the path. Section 6 compares the stores.

### 4.3 Recommendation

Do 4.1 first. It is the smallest thing that removes the four governments'
APIs from the critical path of the map screen, it is cacheable end to end,
its cost does not grow with users, and every byte it serves is produced by
code the app already has. Add 4.2 later for the corridor, favorites and
history, once the tiles have shown the ingester is reliable.

## 5. The ingester

One scheduled job every 10 minutes (the French cadence; Spain and the
others could run every 30): download the four national fluxes, run the
**existing parsers**, apply the **existing brand enrichment**, partition,
write the tiles that changed, write a manifest (`asOf` per country, tile
hashes) — the app reads the manifest to know how fresh the numbers are.

Measured cost of one full cycle in Node on this sandbox (four countries):

| Step | CPU |
| --- | --- |
| JSON.parse + normalize (fr, es, pt, ad) | 4.5 s |
| Brand enrichment, France | 54 ms |
| Partition + gzip 442 tiles | 0.2 s |
| (same with brotli at the default quality) | (18.7 s — do not) |

Peak resident memory was 486 MB in Node with every raw download held as a
string at once, 115 MB of heap. **That is the one real risk on Cloudflare
Workers (128 MB per isolate):** the French export is 29 MB of JSON and the
Spanish one 12 MB. Mitigations, in order of preference:

1. Run each country in its own invocation (four cron triggers, or one
   trigger that fans out through a queue), so no isolate holds more than
   one country.
2. Trim the French export with `select=` — the trimmed export is 6.2 MB
   instead of 29 MB, but with the field list tried here only 3,667 of
   9,442 stations parsed, so the field set has to be validated against
   the parser before relying on it. The roulez-eco XML (12 MB) is the
   other route and needs a new parser.
3. Stream-parse instead of `JSON.parse`, or run the ingester off Cloudflare
   (GitHub Actions on this public repo is free and unlimited, but a
   scheduled workflow can lag its cron by tens of minutes; a €4–5 VPS is
   punctual).

CPU-wise, 144 cycles × ~5 s = 12 min of CPU a day, ~22M CPU-ms a month:
inside the 30M ms the Workers Paid plan includes, and the Free plan's
10 ms per invocation rules it out outright. **Any ingester on Cloudflare
means the $5/month Paid plan**; an ingester elsewhere leaves the serving
side inside the free tiers.

Egress from the ingester: 4.5 + 12.2 + 5.3 + 0.2 ≈ 22 MB per cycle,
3.2 GB a day, ~95 GB a month pulled from the ministries. Upstream fetch
time is I/O and not billed on Workers; the Spanish full download alone is
17 s of it, which makes the per-country split (and per-province fetches
for Spain, which the app already knows how to do) the sensible layout.

## 6. Storage options compared

Criteria: fits the write pattern (a few hundred objects every 10 min),
the read pattern (public, cacheable, bursty), the size (18 MB live, ~25 MB
a month of history), the geographic question (a circle, a polyline), the
cost at zero users and at many, and how much of it a Worker can do alone.

| Store | Fit for tiles (4.1) | Fit for a query API (4.2) | Geo query | Free tier (Sept 2026) | Paid | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Cloudflare R2** (object storage) | **ideal**: public bucket on a custom domain, edge-cached, zero egress | no | none (files) | 10 GB, 1M class A (writes), 10M class B (reads)/month, egress free | $0.015/GB-month, $4.50/M writes, $0.36/M reads | 445 tiles × 144 cycles ≈ 1.9M writes/month if every tile is rewritten (~$4); a few hundred thousand once only changed tiles are written (free) |
| **Workers KV** | good: 25 MiB values, `cacheTtl` at the edge; needs a Worker in front (a KV read is $0.50/M) | partial (whole-country blob read + filter in the Worker: ~50 ms CPU a request) | none | 100k reads/day, 1k writes/day, 1 GB — the 1k writes/day forbid tile rewrites on Free | with Paid: 10M reads + 1M writes included, then $0.50/M reads, $5/M writes | 1 write per second per key; eventual consistency (up to 60 s) is fine for prices |
| **D1** (SQLite, serverless) | overkill | good for `byIds`, history, stats; a circle query is a lat/lng bbox scan | bbox on indexed columns; no PostGIS | 5M rows read/day, 100k rows written/day, 5 GB (500 MB per database) — **limits are enforced with errors since 2026-09-01** | with Paid: 25B reads + 50M writes included, $0.001/M reads, $1/M writes, $0.75/GB | a 25 km query reads ~1–2k rows: ~2.5k requests/day on Free. Writes must be diffs: rewriting all 69k price cells every cycle is 10M rows/day, 100× the free tier and $50+/month on Paid |
| **Durable Object, SQLite-backed** | overkill | **best of the Cloudflare options**: one object holds the 18 MB dataset in memory, answers circle / polyline / ids in ~1 ms CPU, persists in its SQLite, refreshes itself with an Alarm (no cron) | in memory (haversine, the app's own `geo.ts`) | same row limits as D1 (5M reads/day, 100k writes/day, 5 GB); Free may only create SQLite-backed objects | with Paid: same rows as D1, $0.20/GB, plus $0.15/M DO requests and $12.50/M GB-s of active duration (an object active around the clock at 128 MB ≈ $4/month) | single location by design (fine for FR/ES/PT/AD users), single-threaded: one object is plenty at this size |
| **Turso** (libSQL) | overkill | fine; embedded replicas | bbox | 5 GB, 500M row reads/month | from $4.99/month | another vendor, another token, for nothing D1/DO cannot do here |
| **Postgres/PostGIS on a VPS** (Hetzner CX23 €3.99–5.49/month; Fly.io shared-cpu-1x $2–6/month) | fine as the origin behind Cloudflare's cache | fine; real geo indexes; unlimited CPU; the most freedom | PostGIS | none (flat fee) | €4–6/month whatever the traffic | you run it: TLS, updates, disk, monitoring, backups. Behind the orange cloud its responses are edge-cached like R2's. The « it is in maintenance » case the fallback exists for |

Verdict:

- **Tiles → R2**, written by the ingester, served from a custom domain
  (`data.plein.zadkiel.fr` or `/data/` on the app's own Worker) with
  `Cache-Control: public, max-age=300` and an `ETag`, so a revalidation is
  a 304 and costs nothing. KV is a defensible second choice if keeping a
  single Worker is worth $0.50 per million reads.
- **Query API and history → one SQLite-backed Durable Object**, when phase
  2 comes. It is the option that reuses the most app code (the geometry
  helpers, the corridor projection, the candidate thinning could all run
  server-side unchanged) and the only one where a request never waits on
  a database. D1 is the alternative if a history table queried from
  several places matters more than the in-memory index.
- **A VPS is the escape hatch**, not the plan: cheapest at scale, best
  tooling (PostGIS), worst on the axis the whole study is about — being
  down without anyone on call.

## 7. What it would cost

Assumptions: a session is one area load (4 tile requests at z9), a
revalidation every 10 minutes while the app is open (say 2 more rounds),
one favorites refresh, and a route on one session in five. Round it to
25 requests a session; a good share hit the edge cache (tiles are shared
between users of the same 75 km square, cached 5 minutes) — assume half
reach the origin. Scenarios are daily sessions, not installs.

| | 200 sessions/day | 2,000 | 20,000 | 200,000 |
| --- | --- | --- | --- | --- |
| Requests / month | 150k | 1.5M | 15M | 150M |
| Origin reads (R2 class B) / month | 75k | 750k | 7.5M | 75M |
| **Tiles on R2 + ingester on GitHub Actions** | $0 | $0 | $0 (reads under 10M free) | ~$25 (65M reads × $0.36) |
| **Tiles on R2 + ingester on a Worker cron** | $5 | $5 | $5 | ~$30 |
| **Same, tiles served through the app's Worker** (R2 or KV binding, 1 request = 1 Worker invocation) | $5 | $5 | $6.50 (5M requests over the 10M included) | ~$50 |
| **Query API on a Durable Object** (phase 2, on top) | +$4 (duration) | +$4 | +$6 | +$30 |
| **VPS origin** (Hetzner CX23) instead of all of the above | €4–6 | €4–6 | €4–6 | €4–6 (+ time) |
| Storage, any option | cents | cents | cents | cents |

Reading it: **under twenty thousand sessions a day the whole thing is
$0 to $5 a month**, and the $5 is the Workers Paid plan the ingester needs
if it runs on Cloudflare. The lines only diverge at a scale the app is
nowhere near, and at that scale the direct-to-upstream design has its own
cost: 20,000 sessions a day at 3 ODS pages each is 60,000 calls, above the
mirror's daily rate limit for a single IP but spread across users' IPs
today — a backend concentrates that traffic behind one IP, and 144 export
calls a day are what the backend spends instead.

Not in the table: routing (OSRM demo server, FOSSGIS Valhalla) and
geocoding stay on public instances that ask not to be used in production.
They are the next candidates for the same treatment and a larger study
(self-hosted OSRM for four countries is a 3–4 GB graph and a €10–20 VPS).

## 8. The fallback, and how much code survives

The short answer: almost all of it, because the backend is fed by the
client's own code and the client's failure path already exists.

**Reused as is, on the server side (the ingester):**

- `src/data/fr|es|pt|ad/*StationsProvider.ts` parsing (`parseRecord`,
  `groupStations`, `parsePrices`, `parseOpeningHours`, `deriveTags`…) —
  pure functions over the raw fluxes, already unit-tested, already bundled
  for Node by `scripts/live-providers.mjs`. The ingester is that script
  with a writer at the end.
- `src/data/fr/osmBrands.ts` (`enrichWithBrands`) and `public/brands-fr.json`:
  run once per cycle on the server instead of once per device. French
  tiles ship pre-branded, so the client stops downloading the 292 KB index
  on the backend path.
- `src/data/stationIds.ts`: ids keep their `fr-`/`es-`/`ad-`/`pt-` scheme,
  so favorites, `/station/:id` links and the `getStationsByIds` favorites
  refresh keep matching.
- `src/lib/geo.ts` (haversine, polyline projection, sampling) for
  partitioning and, in phase 2, for the corridor endpoint.

**New on the client:**

- A `BackendStationsProvider` implementing the existing `StationsProvider`
  interface (`getStationsNear`, `getStationsAlong`, `getStationsByIds`) over
  the tile endpoint: compute the covering tiles, fetch them in parallel,
  filter the circle. A few hundred lines, same shape as the four
  national ones, testable with mocked `fetch` like them.
- A composition, `withFallback(backend, upstream)`, that tries the backend
  under a short budget and hands over to today's provider on any failure.
  The budget is the whole point: upstreams answer in 1–3 s and the client
  waits 9–15 s for them; the backend should be given ~2.5 s, after which
  the upstream path starts and the user never waits longer than today.
  A per-session circuit breaker (two failures → skip the backend for
  5 minutes, memory class, like the province memos) keeps a dead backend
  from taxing every load by 2.5 s.
- Wiring in `src/data/providers.ts`: `createBundle` wraps each real
  source's `stations` provider; `demo` stays local; « force offline mode »
  stays in front of both.

**Touched in the store, deliberately small:**

- `fetchedAt` is currently `Date.now()` at the moment the provider answers
  (`store.tsx`, the `loadStations` success path). A backend answer carries
  the snapshot's own `asOf`; the store must take the older of the two or
  the freshness chip would call ten-minute-old numbers « just now ». That
  is a return-type change on `StationsProvider` (stations plus an optional
  `asOf`) or a header read in the backend provider, and one line in the
  store. The three cache tiers in `stationsCache.ts` (10 min / 6 h / 7 d)
  need no change: they already measure from `fetchedAt`.
- Which path answered is developer data: the debug overlay snapshot
  (`src/lib/debugSnapshot.ts`) gains a `stationsPath: 'backend' | 'upstream'`
  field and the failure reason. No catalog key: the user-facing UI does
  not need to know, which is the design goal.

**Unchanged:** IndexedDB caching, the containment fast path, the route
pipeline's three stages (the corridor stage simply calls the wrapped
provider), the selectors, every screen, the service worker (prices still
never go through it — the backend's `Cache-Control` is honored by the
browser's HTTP cache and by the edge, both of which the `fetchedAt`
carried in the payload makes honest).

**Tests:** the unit tests of the parsers become the ingester's tests for
free. The backend provider gets its own with a mocked `fetch`. The e2e
fixture fails on a console error, so a backend miss must be logged at
`debug`, not `error`; specs that need the backend path mock `/data/v1/**`
with `page.route` exactly as the French flux specs mock `**/proxy/fr/**`,
and one spec asserts the fallback: backend route returns 503, the demo
stations still paint.

**Cutover risk is bounded by construction.** Shipping the backend
provider behind the wrapper means the worst case of a backend bug is
today's behavior plus a 2.5 s delay. A `?backend=0` query flag (or the
debug overlay) to force the upstream path makes support trivial.

## 9. Things the backend changes that are not code

- **Privacy improves.** Today the search center leaves the device to four
  ministries' APIs at ~11 m precision. With tiles, the backend (and its
  logs) see a 75 km square. Keep it that way: no query-string coordinates
  on the tile endpoint, and no request logging beyond Cloudflare's
  aggregate analytics, which the app already has enabled
  (`observability` in `wrangler.jsonc`).
- **Licenses allow redistribution but want attribution.** France's Licence
  Ouverte 2.0 and Spain's datos abiertos terms permit reuse and
  redistribution with the source named; the README already names all
  four. Portugal (DGEG) and Andorra (Govern d'Andorra SIG) publish through
  APIs whose terms are less explicit — worth one email each before a
  public mirror goes up, and a `source` + `asOf` per station in the
  payload is cheap provenance.
- **We become an upstream too.** A public tile endpoint will get scraped;
  that is fine (R2 egress is free) and the reason the tiles carry no more
  than the app shows.
- **Freshness is now a promise we make.** Today a stale price is the
  ministry's fault; with a backend, a stuck ingester serves last night's
  prices with our name on them. The manifest's `asOf` must drive the
  freshness chip, the ingester must alert on a missed cycle (a Worker cron
  logs its failures in the observability the app already has on; a
  « manifest older than 30 minutes » check is the alert to wire), and the
  client's `MAX_CACHE_AGE_MS` logic (drop, do not paint) must apply to a
  backend snapshot older than 7 days exactly as to a cached area — which
  it does if `asOf` feeds `fetchedAt`.

## 10. A phased path

1. **Measure before building.** Turn on the numbers the study assumed:
   sessions a day, area loads a session, upstream failure and timeout
   rates per country (the debug snapshot already records the source that
   answered; a `reportAreaLoad` counter is one Analytics Engine write).
   Two weeks of that decides whether phase 2 is ever needed.
2. **Tiles.** Ingester = `scripts/live-providers.mjs` plus a tiler and an R2
   writer, on a Worker cron (Paid, $5) or GitHub Actions ($0, laggy).
   Client = `BackendStationsProvider` + `withFallback`, `getStationsNear`
   only; corridor and favorites stay upstream. Ship behind the wrapper, watch
   the path split in the debug snapshot.
3. **Corridor and favorites on the backend.** Either more tiles (simple,
   heavier for long routes) or the Durable Object with `along` and `byIds`.
4. **History.** The Durable Object (or D1) keeps the changed cells; the
   station sheet gets a 30-day sparkline; the route optimizer can start
   using « usually cheaper here » — the first feature the upstreams could
   never give.
5. **Routing and geocoding**, separately: a larger, different study.

## 11. Open questions for the maintainer

- Where should the ingester live: the app's own Worker (one `main` next
  to the static assets, one cron, the $5 plan) or GitHub Actions (free,
  but « every 10 minutes » becomes « roughly every 10 to 40 minutes »)?
- Is a per-country `asOf` in the freshness chip acceptable, or should the
  chip stay on the client's own `fetchedAt` and the backend snapshot age be
  developer-only? (The study assumes the honest version.)
- Is price history a goal? It is the only thing here that needs a
  database, and it decides phase 4 and the D1-versus-Durable-Object choice.

## 12. How the numbers were obtained

All measurements ran on 2026-09-17 from the Claude Code sandbox
(4 vCPU, Node 22), through the session's egress proxy:

- Sizes and timings: `curl --compressed -w '%{size_download} %{time_total}'`
  against the endpoints the providers use (`FrStationsProvider.ts`,
  `EsStationsProvider.ts`, `PtStationsProvider.ts`, `AdStationsProvider.ts`),
  the ODS `exports/json` endpoint and the roulez-eco zip.
- Normalized sizes, tile partitions, churn and CPU: the providers bundled
  with esbuild the way `scripts/live-providers.mjs` does, the exported
  parsers run over the downloaded files, `JSON.stringify` measured raw and
  through `zlib` gzip/brotli. Tile keys use the standard Web Mercator XYZ
  formula. Churn compares two downloads of the same flux (France: two
  exports 25 minutes apart plus the per-price `*_maj` stamps; Spain: two
  full downloads 7 minutes apart).
- Prices and limits: Cloudflare's Workers, KV, D1, Durable Objects and R2
  pricing and limits pages; Turso's pricing page; Hetzner and Fly.io price
  lists as reported in September 2026. They change; re-read them before
  committing to a plan.
