# Plein. — notes for agents

PWA React 18 + TypeScript (strict) + Vite + Leaflet. Cheapest fuel stations
around you and along a route (France · Spain · Andorra), deployed on
Cloudflare Workers. The app is localized: French is the source locale, and it
lives only in `messages/fr.json`.

## Language

- **French is the source locale and lives in exactly one place**:
  `messages/fr.json`. `messages/en.json`, `messages/es.json` and
  `messages/ca.json` (Catalan, the language of Andorra) translate it.
  **No bare string literal reaches JSX** — labels, empty states, toasts,
  `aria-label`s, `placeholder`s, `title`s all come from a message function.
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
