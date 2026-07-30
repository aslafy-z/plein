# Plein. — notes for agents

PWA React 18 + TypeScript (strict) + Vite + Leaflet. Cheapest fuel stations
around you and along a route (France · Spain · Andorra · Portugal), deployed
on Cloudflare Workers. The app is localized: French is the source locale, and
it lives only in `messages/fr.json`.

## Language

- **French is the source locale and lives in exactly one place**:
  `messages/fr.json`. `messages/en.json`, `messages/es.json`,
  `messages/ca.json` (Catalan, the language of Andorra) and `messages/pt.json`
  translate it. **No bare string literal reaches JSX** — labels, empty states,
  toasts, `aria-label`s, `placeholder`s, `title`s all come from a message
  function.
- **Everything else is English**: type names, union literal values, object
  keys, store fields, constants, function names, message keys, code comments,
  JSDoc/TSDoc, docs and Markdown files, test names and descriptions, GitHub
  issues, pull request titles and bodies, commit messages, and PR/issue
  comments and review replies.
- Don't translate existing French comments you happen to touch; only what you
  newly write follows this rule.
- The **only** admitted French outside the catalog is text a source API
  invents (the gouv flux's free-text services) and proper nouns (enseignes,
  domain names, `Haute-Garonne`).

## Internationalization

[Paraglide JS](https://paraglidejs.com) is a **devDependency**: a compiler,
not a runtime. `npm run messages` turns `messages/{locale}.json` into typed,
tree-shakable functions under `src/paraglide/` (gitignored).

**Anything that reads the generated code needs it compiled first**, and only
`npm run dev` gets that from the Vite plugin. `typecheck`, `test`, `e2e` and
`build` each run `npm run messages` from a `pre*` script — `build` included,
because its `tsc -b` runs *before* Vite loads the plugin. A fresh clone that
skips those scripts sees `Cannot find module '../paraglide/messages.js'`.

- Message keys are `area_element_purpose` (`settings_vehicle_section`,
  `sheet_cheapest_nearby`) and compile to `m.settings_vehicle_section()`.
  `tsc` fails on a typo or a missing parameter.
- **Never assemble a sentence from fragments.** Word order and agreement
  differ per language: write one key per whole sentence (see the four
  `sheet_cheapest_*` / `sheet_best_choice_*` keys).
- Plurals are catalog variants (CLDR categories) — never `n > 1 ? 's' : ''`.
  French counts 0 as singular.
- Numbers, wall clocks and relative dates go through `Intl` in
  `src/lib/format.ts`. Never hand-roll `.replace('.', ',')`.
- Ids become words in exactly one place: `src/lib/labels.ts`.
- **Pure logic returns data, not copy.** `openStatus()` and
  `selectRouteAnalysis()` return discriminated unions; the view turns them
  into sentences. That keeps `hours.test.ts` / `selectors.test.ts` asserting
  on behaviour.
- The locale is a normal persisted setting inside `plein.settings.v1`, read
  and written by the `custom-appSettings` strategy in `src/lib/locale.ts`.
  Resolution order: explicit choice → browser language → French.
- Adding a locale: add it to `project.inlang/settings.json`, add
  `messages/<locale>.json`, add its name to `localeName()` in `Settings.tsx`.

## Layout: one app, two arrangements

There is no desktop build and no phone frame. The same screens rearrange, and
**`src/lib/layout.ts` is the only place that decides which arrangement is on**
**screen**: `useIsDesktop()` (a `useSyncExternalStore` wrapper over `matchMedia`)
against `DESKTOP_MIN_WIDTH` = 960. Components branch on that boolean in React
rather than on a media query of their own — a duplicated breakpoint in CSS is
how a layout and the components inside it end up disagreeing. The gate is
width, never pointer type: a window gets resized and the layout has to follow.

| | phone | desktop |
| --- | --- | --- |
| navigation | `NavBar` (bottom tabs) | `SideNav` (rail) |
| zone card + list | `MapSheet` (dragged) | `ZonePanel` (floating glass panel) |
| filters | bottom sheet | popover anchored under the chips |
| station fiche | full screen, mini-map header | stacked under the list, no mini-map |
| route | 210px map strip + timeline | floating timeline over `RouteMap fill` |

- **Presentation is shared, never forked.** `ZoneCard`, `ZoneList` and
  `ZoneEmpty` are what the phone sheet and the desktop panel both render; the
  sheet passes its drag handle and the pointer handlers its drag-to-close
  needs, the panel passes neither. The gesture engine is the only phone-only
  code. Anything you add to the zone goes in those three components, not in
  one arrangement.
- `selectZoneLead` is the one answer to « does the zone have anything to
  show ». Null means no card, and therefore no list: `ZoneCard` hands over to
  `ZoneEmpty`, the sheet has nothing to expand to, and the desktop panel slot
  hugs that block instead of stretching to the bottom edge — a full-height
  pane of glass around one sentence reads as broken rather than as an empty
  state. The block is shared; the sizing is the slot's call.
- On desktop the map runs edge to edge and everything else floats over it in
  one « glass » language: `glass` and `floatingPanelStyle` in `theme.ts` are
  the whole vocabulary. MapScreen owns the panel slot; RouteRibbon puts its
  timeline in the same slot. Opening `/station/:id` keeps the map mounted and
  stacks the fiche UNDER the zone list inside that panel — a list row opens it
  in one click, and the fiche selects its station on the live map (halo +
  pan to the VISIBLE center) and releases it on close.
- `PANEL_WIDTH`, `PANEL_GAP` and `CONTENT_MAX_WIDTH` live in `layout.ts`. The
  panel floor is what a station row needs to fit on one line — below it names
  wrap and the list stops being scannable.
- The floating panel covers the map's LEFT edge, so `MapCanvas` and `RouteMap`
  take a `leftInset` (the measured panel width + gaps) and pad their auto-fits
  with it: the zone circle and the route corridor land centered in the VISIBLE
  part of the map. It is the desktop mirror of the phone sheet's
  `bottomInset`, which desktop passes as 0.
- App-level notices (`UpdatePrompt`, `FallbackBanner`) are bars at the top of
  `.app-main`, not map controls. The install offer is a bar on the phone only
  (`InstallPrompt`); on desktop it lives in the side rail's bottom slot with
  the geolocation notice and the app version — permanent chrome, so it never
  covers the map it is offering to install.

## Storage: four classes, one home each

Every piece of data the app holds belongs to exactly one of these, and the
class decides where it lives, how long it may be shown, and how it is dropped.
Anything that does not fit one of them does not get cached.

| class | data | where | lifetime |
| --- | --- | --- | --- |
| durable, app-owned | settings, filters, favorites, recents, `lastPos` | localStorage `plein.settings.v1` | none; shape migrations in `persist.ts` `migrate()` |
| durable, app-owned | station arrays per fetched area | IndexedDB `plein.cache` (`src/data/cacheStore.ts`) | three tiers, below |
| memory | province/district memos, `roadReach`, selector memos, brand POI index, geocode + route LRUs | JS maps | the session |
| static, SW-owned | bundles, icons, fonts, shell, tiles, `/brands-fra.json`, `/brand-icons/*` | Cache Storage (`public/sw.js`) | cache-name version bump + FIFO caps |

- **Prices never go in the service worker.** `fetchedAt` per fetched area is
  the single source of truth about how old the numbers on screen are; an HTTP
  cache in front of a price API would age them without anything knowing.
- **Three tiers, all off `fetchedAt`** (`src/data/stationsCache.ts`):
  under `STALE_MS` (10 min) the network is not touched at all; under
  `MAX_CACHE_AGE_MS` (7 d) the area paints immediately and revalidates behind,
  the freshness chip naming the day past `REVALIDATE_MS` (6 h) instead of
  saying « il y a N j »; beyond, the area is dropped and the app shows its
  loading/error path rather than last week's prices.
- **The index is eager, the payloads are lazy.** `areas` (a few hundred bytes)
  loads at boot so the containment test runs in memory; a station array is read
  only when its area actually matches. `writeStationsCache` stays synchronous
  and `readStationsCache` is async — the `loadedArea` fast path in
  `store.tsx` must stay synchronous or live circle drags start waiting on IO.
- **Durability is best-effort.** `openCacheStore()` never rejects: a blocked
  open, a private window or a refusing browser yields the in-memory store, and
  the app behaves as before minus persistence. A `QuotaExceededError` sheds
  the oldest area and retries once; a second failure stops persisting for the
  session. `cacheStats()` is what Settings « Données » renders — the
  instrumentation is data, since the e2e fixture fails on a console error.
- Seeding a cached area in e2e goes through `seedStationsCache()`
  (`e2e/fixtures.ts`), which writes IndexedDB from a loaded page and expects a
  reload; its record shape mirrors `AreaMeta` and the two have to agree.

## Commands

```sh
npm run messages    # compile messages/*.json → src/paraglide (gitignored)
npm run typecheck   # tsc -b --noEmit
npm test            # vitest unit tests (src/**/*.test.ts, node env)
npm run e2e         # Playwright (starts the Vite dev server itself) — see
                    # "Where to run the e2e suite" before running this
npm run build       # tsc + vite build
```

## Testing conventions

- **Unit tests (Vitest)** live next to the code (`src/**/*.test.ts`) and use
  `vitest.config.ts` (NOT `vite.config.ts` — the Cloudflare plugin must not
  load under vitest). Pure logic belongs here: the derived selectors in
  `src/state/store.tsx` (price tiers, recommendation, route strategies,
  autonomy…) and the `src/lib/` helpers are all pure functions — prefer a
  unit test over an e2e test whenever the behavior is computable without a
  browser.
- CI (`.github/workflows/tests.yml`) runs typecheck + unit tests and the
  Playwright suite on every PR and on pushes to `main`.
- **E2e tests (Playwright)** live in `e2e/` and cover UI wiring only. They
  run against the deterministic offline demo dataset
  (`src/data/demo/demoData.ts`, centred on Toulouse) via the `seed` fixture
  in `e2e/fixtures.ts`, which installs the persisted settings blob before
  boot — seed `sourceId`, `favorites`, `lastPos`… instead of clicking
  through setup. Tests needing the French flux mock `**/proxy/fra/**` and
  `**/brands-fra.json` with `page.route`. The fixture fails any test whose
  page logs a console error. It also pins `locale: 'fr'` into every seed —
  the runner's Chromium asks for `en-US`, and the assertions read French.
  Override it in a spec's `seed` to assert on another language.
- **Two projects, two layouts.** `mobile` (Pixel 7) and `desktop` (1440×900)
  now see genuinely different arrangements, so a spec must say which one it is
  about: `phoneOnly()` / `desktopOnly()` from `e2e/fixtures.ts` gate on the
  project's own viewport against the same 960px number. Reveal the zone list
  through `openZoneList()` / `closeZoneList()` rather than clicking the sheet
  handle — the handle only exists on a phone. Layout-agnostic behaviour (price
  tiers, the recommendation, filters wiring) stays in one spec that runs on
  both; `desktop.spec.ts` covers the desktop arrangement itself.

## Where to run the e2e suite

`npm run e2e` is fast on a local machine, but painfully slow on Claude Code
cloud sessions — a full run there can eat most of a turn. So:

- **On Claude Code cloud (the sandboxed remote session — that's where you are
  if `npx playwright test` can't find its pinned browser): prefer CI.** Push
  the branch and let the `e2e` job in `.github/workflows/tests.yml` run the
  Playwright suite, then watch the run to completion and read the result
  (`playwright-report/` is uploaded as an artifact on failure). Treat the CI
  run as the verification step — don't call the change verified until the job
  is green, and iterate by pushing fixes rather than by re-running in the
  session. Running one narrowly-targeted spec in-session to debug a specific
  failure is fine; running the whole suite is not.
- **On a real local machine: just run `npm run e2e`.** Typecheck and unit
  tests (`npm run typecheck`, `npm test`) stay in-session everywhere — they're
  cheap.

### Playwright in the sandbox

For those narrow in-session runs, the pinned Playwright browser build is
absent from the Claude Code cloud sandbox (`Executable doesn't exist … Please
run npx playwright install`). Do NOT download browsers; point the config at
the pre-installed system Chromium instead:

```sh
PLEIN_CHROMIUM=$(which chromium || echo /opt/pw-browsers/chromium) npx playwright test
```

`playwright.config.ts` reads `PLEIN_CHROMIUM` as `launchOptions.executablePath`.
