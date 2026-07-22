# Plein. — notes for agents

PWA React 18 + TypeScript (strict) + Vite + Leaflet. Cheapest fuel stations
around you and along a route (France · Spain · Andorra), deployed on
Cloudflare Workers. UI copy is French — keep it that way.

## Commands

```sh
npm run typecheck   # tsc -b --noEmit
npm test            # vitest unit tests (src/**/*.test.ts, node env)
npm run e2e         # Playwright (starts the Vite dev server itself)
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
- CI (`.github/workflows/e2e.yml`) runs typecheck + unit tests and the
  Playwright suite on every PR and on pushes to `main`.
- **E2e tests (Playwright)** live in `e2e/` and cover UI wiring only. They
  run against the deterministic offline demo dataset
  (`src/data/demo/demoData.ts`, centred on Toulouse) via the `seed` fixture
  in `e2e/fixtures.ts`, which installs the persisted settings blob before
  boot — seed `sourceId`, `favorites`, `lastPos`… instead of clicking
  through setup. Tests needing the French flux mock `**/proxy/fra/**` and
  `**/brands-fra.json` with `page.route`. The fixture fails any test whose
  page logs a console error.

## Playwright in sandboxes

The pinned Playwright browser build is often absent in sandboxed/CI-like
environments (`Executable doesn't exist … Please run npx playwright
install`). Do NOT download browsers; point the config at the pre-installed
system Chromium instead:

```sh
PLEIN_CHROMIUM=$(which chromium || echo /opt/pw-browsers/chromium) npx playwright test
```

`playwright.config.ts` reads `PLEIN_CHROMIUM` as `launchOptions.executablePath`.
