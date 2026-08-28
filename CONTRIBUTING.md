# Contributing to Plein.

Thanks for being here. Plein. shows the cheapest fuel around you and along a route in France, Spain, Andorra and Portugal, off the official open-data flux of each country. It is a small codebase with a few opinions — this page is the short version of them.

This file is English, like everything in the repo outside `messages/` and the five READMEs.

## Reporting a bug, asking for a feature

Open an issue and pick the form that fits: **Bug report**, **Wrong station data**, or **Feature request**. No GitHub account? `plein@zadkiel.fr` reaches the same place.

**For a bug, paste the debug overlay snapshot.** It is one copy and it answers most of what a maintainer would otherwise ask you over three round trips — app version, arrangement and viewport, which source answered and how old the prices on screen are, the cached areas, the service-worker and storage state, the recent console errors.

1. In the app, open **Settings › Offline data › Debug overlay** (or add `?debug=1` to the URL).
2. A floating **DBG** chip appears — tap it.
3. **Copy JSON** in the panel header, then paste into the form. **Report** does both at once: it copies the snapshot and opens the bug form for you.

Coordinates in it are rounded to a ~1 km grid, so it says which town you were in, never where you are.

**A wrong price is not necessarily a bug in this repo.** The app shows what stations declare in the official flux; if the flux is stale, the fix is upstream, with the station or the ministry running it. The « Wrong station data » form exists to tell that case apart from the one where the flux is right and we read it wrong.

## Getting set up

Node 22 (what CI runs), npm, and nothing else — the app has four runtime dependencies.

```bash
npm install
npm run dev          # http://localhost:5173
```

Behind a corporate proxy or in a sandbox without direct internet access, the dev server proxies the APIs (`/proxy/*`) and the tiles (`/tiles/*`) honoring `HTTPS_PROXY` — see `vite.config.ts`.

Nothing to configure: the app ships with the CARTO basemap key it deploys with, so a fresh clone draws a real map. To build against your own CARTO account instead, set `VITE_CARTO_KEY` in `.env.local` or in the environment the build runs in — `.env.example` documents it, and an unset or blank value falls back to the shipped key. It is baked into the client bundle like any `VITE_*` value, so it is public by construction: no secret goes in those files.

| command | what it does |
| --- | --- |
| `npm run dev` | Vite dev server, messages compiled by the plugin |
| `npm run build:messages` | compiles `messages/*.json` into `src/paraglide/` (gitignored) |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm test` | Vitest, `src/**/*.test.ts` |
| `npm run e2e` | Playwright, `e2e/` — starts the dev server itself |
| `npm run build` | production build into `dist/` |
| `npm run verify:live` | hits the real providers and geocoders, to see whether an upstream moved |
| `npm run deploy` | build + `wrangler deploy` — maintainers only; PRs get a preview deploy from CI |

Three more regenerate committed assets, so run them when what they generate changed rather than on every change: `build:brands` (the OpenStreetMap brand index behind `public/brands-fr.json`), `build:icons` (the brand icons) and `build:screenshots` (the per-locale screenshots in `docs/screenshots/`, whose selector strings come from the catalogs).

[Paraglide JS](https://paraglidejs.com) is a compiler, not a runtime: `src/paraglide/` is generated and gitignored. Only `npm run dev` gets it from the Vite plugin — every other script recompiles it from a `pre*` hook. A fresh clone that skips those sees `Cannot find module '../paraglide/messages.js'`; `npm run build:messages` fixes it.

## The house rules

Four of them explain most review comments.

**No bare string reaches JSX.** Labels, empty states, toasts, `aria-label`s, `placeholder`s, `title`s — all of it comes from a message function. French is the source locale and lives in `messages/fr.json`; `en`, `es`, `ca` and `pt` translate it. Write one key per whole sentence (never assemble one from fragments — word order and agreement differ per language), use CLDR plural variants rather than `n > 1 ? 's' : ''`, and route numbers, clocks and dates through `Intl` in `src/lib/format.ts`. Ids become words in exactly one place, `src/lib/labels.ts`.

Everything else is English: type names, keys, constants, comments, docs, test names, commit messages, issue and PR text. When you name a screen or a button in prose, use its **English** copy from `messages/en.json` — the Settings « Data » section, the « Directions › » shortcut.

The debug overlay and the cache diagnostics are the exemption: developer tooling, English-only data meant to be pasted into a bug report, none of it in `messages/`.

**One app, two arrangements.** There is no desktop build — the same screens rearrange around a single breakpoint, and `useIsDesktop()` in `src/lib/layout.ts` is the only place that decides which arrangement is on screen. Branch on that boolean in React, never on a media query of your own. Presentation is shared between the two (the phone sheet and the desktop panel render the same `ZoneCard` / `ZoneList` / `ZoneEmpty`); only the gesture engine is phone-only.

**Pure logic returns data, not copy.** Selectors and helpers return discriminated unions; the view turns them into sentences. That is what keeps them unit-testable.

**Never hard-wrap a commit message or a PR description.** One long line per paragraph, and let the renderer wrap.

`CLAUDE.md` at the root is the long version — storage classes, the route pipeline's three stages, the Leaflet shell — worth a read before a change that touches any of them.

## Tests

- **Vitest** (`src/**/*.test.ts`) sits next to the code and uses `vitest.config.ts`, not `vite.config.ts`. Anything computable without a browser belongs here — the derived selectors, the route optimizer, the `src/lib/` helpers. Prefer a unit test over an e2e test whenever you can.
- **Playwright** (`e2e/`) covers UI wiring only. It runs against the deterministic offline demo dataset through the `seed` fixture, which installs the persisted settings blob before boot — seed `sourceId`, `favorites`, `lastPos` instead of clicking through setup. The fixture fails any test whose page logs a console error, and pins the English catalog. Two projects (`mobile`, `desktop`) see genuinely different arrangements, so a spec says which one it is about with `phoneOnly()` / `desktopOnly()`.

## Sending a change

Branch, commit, open a pull request — **early**. CI runs typecheck, unit tests and the Playwright suite on every PR (a branch push alone triggers nothing), so a PR opened as soon as the change compiles and carries its tests gets the full verification running alongside the rest of your work instead of at the end. Keep pushing to the same PR. Each push also deploys a preview on Cloudflare Workers and comments its URL.

`npm run typecheck` and `npm test` are cheap locally and worth running as you go; `npm run e2e` is worth it before asking for a review.

Commit subjects: imperative, English, one line, optionally prefixed the way the log already does it (`fix(map): …`, `docs(readme): …`). The PR template asks for what changed, why, and how to see it — screenshots for anything visual, both arrangements when the layout is involved.

Two things that are easy to forget:

- new copy lands in **all five** catalogs (`fr` first, then `en` / `es` / `ca` / `pt`);
- a README edit lands in **all five** READMEs in the same commit — `README.md` is the English source and `README.fr.md`, `README.es.md`, `README.ca.md`, `README.pt.md` are full mirrors, each using its own language's UI names.

## Adding things

- **A data source**: implement the `StationsProvider` / `GeocodeProvider` / `RouteProvider` interfaces and register it in `src/data/providers.ts`.
- **A locale**: add it to `project.inlang/settings.json`, add `messages/<locale>.json`, add its name to `localeName()` in `Settings.tsx`, add `README.<locale>.md` and its entry in every README's language-switcher line.

## License

By contributing you agree that your code ships under the [MIT license](LICENSE), like the rest of the repo.
