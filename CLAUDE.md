# Plein. — notes for agents

PWA React 18 + TypeScript (strict) + Vite + Leaflet. Cheapest fuel stations
around you and along a route (France · Spain · Andorra), deployed on
Cloudflare Workers. UI copy is French — keep it that way.

## Language

- **UI copy stays French.** Anything the end user reads in the app — labels,
  messages, `aria-label`s, page titles — is written in French.
- **Everything else you produce is written in English**: code comments,
  JSDoc/TSDoc, docs and Markdown files, test names and descriptions, GitHub
  issues, pull request titles and bodies, and PR/issue comments and review
  replies.
- Commit messages follow the existing history, which is French — match the
  surrounding log.
- Don't translate existing French comments or copy you happen to touch;
  only what you newly write follows this rule.

## Commands

```sh
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
  page logs a console error.

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
