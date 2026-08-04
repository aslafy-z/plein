<!-- Write each paragraph as one long line and let the renderer wrap it — never hard-wrap a PR description (CLAUDE.md, Language). English, like everything outside messages/fr.json. -->

## What changed

## Why

<!-- The problem it fixes, or the issue it closes: "Closes #123". -->

## How to see it

<!-- The path a reviewer clicks, or the command they run. Screenshots for anything visual — both arrangements (phone and desktop) when the change touches the layout. -->

## Checks

<!-- Tick what applies, strike out what doesn't. CI runs typecheck, unit tests and the Playwright suite on this PR — pushing early is what gets them running. -->

- [ ] `npm run typecheck` and `npm test` pass
- [ ] New copy goes through the catalogs: written in `messages/fr.json` (the source locale) and translated in `en` / `es` / `ca` / `pt`, one key per whole sentence
- [ ] Behaviour computable without a browser is covered by a unit test next to the code; UI wiring by an e2e spec saying which arrangement it is about
- [ ] A README edit lands in all five (`README.md`, `README.fr.md`, `README.es.md`, `README.ca.md`, `README.pt.md`)
