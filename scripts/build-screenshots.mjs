// Regenerates docs/screenshots/<locale>/*.png — the screenshots the READMEs
// embed, one set per app locale (en, fr, es, ca, pt), each image a diagonal
// light/dark split (light upper-left, dark lower-right) so one picture shows
// both themes.
//
// The shots are taken against the LIVE sources (`sourceId: 'auto'`), not the
// deterministic demo dataset: real prices, real station names and a real OSRM
// corridor are the point of these images, so every run produces the prices of
// the day. Each locale plays a scene in its own country — the map and the
// fiche around a well-known city, the trip a classic domestic run (SCENES
// below) — matching the captions in that locale's README.
//
// The UI language is seeded through the persisted `locale` setting (the same
// switch the Settings screen writes), and every selector string comes from
// that locale's message catalog — messages/<locale>.json is the single source
// of truth for what the screen says. Each screen is shot twice, dark then
// light, by flipping the emulated `prefers-color-scheme` (the app's theme
// default follows the browser), and the two frames are composited along a
// diagonal.
//
// The viewport is 480×1064 at DPR 3 (1440×3192), which the READMEs display at
// width 250. That width is deliberate: the map auto-fit frames the search
// circle into the viewport and snaps to an integer zoom, so a narrower phone
// (390 or 430 CSS px) lands one level further out and packs the price bubbles
// of a dense centre on top of each other. PNGs are re-encoded losslessly
// afterwards — Chromium's own encoder leaves roughly 45% on the table.
// Usage: npm run build:screenshots [map] [station] [route] [en] [fr] [es] [ca] [pt] [--headed] [--parallel]
// Naming shots and/or locales regenerates only those — handy to refresh one
// language's fiche without reshooting every map with the prices of another day.
// --headed opens a visible browser window to watch the run navigate — the
// captures are identical, it only helps to see where a selector goes wrong.
// --parallel runs the locales concurrently, one browser context each. Shots
// within a locale stay sequential (they walk one page through the screens).
// It multiplies the concurrent load on the live feeds and the OSRM demo
// server by the locale count — if a run turns flaky, drop back to sequential.
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/screenshots');
// A dedicated port so a dev server already running on 5173 is left alone
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 480, height: 1064 };

const SHOTS = ['map', 'station', 'route'];
const LOCALES = ['en', 'fr', 'es', 'ca', 'pt'];
// Full BCP 47 tags for the browser context, so Intl formats match the catalog
const CONTEXT_LOCALE = { en: 'en-US', fr: 'fr-FR', es: 'es-ES', ca: 'ca-ES', pt: 'pt-PT' };

// One scene per locale, in the language's own country (English rides along on
// the French one): `center` seeds the position for the map and the fiche,
// `from`/`to` is the trip — endpoints resolve through the auto source, which
// merges all four countries' geocoders, so a trip may cross a border: the
// Catalan scene is Andorra's — map and fiche in Andorra la Vella, the trip
// down to Barcelona, the border fill-up the app exists for. `startTankPct`
// keeps each trip longer than the departure tank's range, or short runs
// would plan no stop at all and the route shot would have nothing to show.
//
// `station` pins the fiche when that station is in the loaded area — the
// fiche has to have something to show, and tapping whatever is cheapest today
// often lands on three fuels over half an empty screen. fra-31100010 is a
// Total Access in Toulouse: GPLc on top of the usual pumps, nine services,
// and an enseigne the mini-map has a logo for. Elsewhere (or should it ever
// leave the flux) the richest loaded station stands in.
const SCENES = {
  en: { center: { lat: 43.6047, lng: 1.4442 }, station: 'fra-31100010', from: 'Toulouse', to: 'Lille', startTankPct: 70 },
  fr: { center: { lat: 43.6047, lng: 1.4442 }, station: 'fra-31100010', from: 'Toulouse', to: 'Lille', startTankPct: 70 },
  es: {
    center: { lat: 40.4168, lng: -3.7038 },
    // « Madrid » alone picks whatever row lands first, and BAN answers fast
    // with a French hamlet literally named Madrid (Lignières-Ambleville).
    // The city row reads label + province — « Madrid Madrid » — so the pick
    // regex runs over the whole row text.
    from: { text: 'Madrid', pick: '^Madrid\\s*Madrid' },
    to: { text: 'Barcelona', pick: '^Barcelona\\s*Barcelona' },
    startTankPct: 40,
  },
  ca: {
    center: { lat: 42.5063, lng: 1.5218 },
    from: 'Andorra la Vella',
    to: { text: 'Barcelona', pick: '^Barcelona\\s*Barcelona' },
    startTankPct: 15,
  },
  pt: { center: { lat: 38.7223, lng: -9.1393 }, from: 'Lisboa', to: 'Porto', startTankPct: 25 },
};

const argv = process.argv.slice(2);
const headed = argv.includes('--headed');
const parallel = argv.includes('--parallel');
const asked = argv.filter((n) => n !== '--headed' && n !== '--parallel');
const unknown = asked.filter((n) => !SHOTS.includes(n) && !LOCALES.includes(n));
if (unknown.length) {
  throw new Error(
    `unknown argument(s): ${unknown.join(', ')} — expected shots (${SHOTS.join(', ')}) or locales (${LOCALES.join(', ')})`,
  );
}
const askedShots = asked.filter((n) => SHOTS.includes(n));
const askedLocales = asked.filter((n) => LOCALES.includes(n));
const wanted = (name) => askedShots.length === 0 || askedShots.includes(name);
const locales = askedLocales.length === 0 ? LOCALES : askedLocales;

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The catalog strings the selectors below rely on, out of messages/<locale>.json. */
async function loadMessages(locale) {
  const catalog = JSON.parse(await readFile(join(ROOT, `messages/${locale}.json`), 'utf8'));
  const need = [
    'sheet_best_choice_nearby',
    'sheet_best_choice_in_area',
    'sheet_cheapest_nearby',
    'sheet_cheapest_in_area',
    'detail_map_aria',
    'nav_route',
    'route_from_field_title',
    'route_to_field_title',
    'route_from_placeholder',
    'route_to_placeholder',
    'ribbon_recommended_stop',
    'ribbon_plan_stop_index',
    'route_sheet_expand_aria',
    'map_route_aria',
  ];
  const msg = {};
  for (const key of need) {
    const value = catalog[key];
    if (typeof value !== 'string') throw new Error(`messages/${locale}.json: ${key} is not a plain string`);
    msg[key] = value;
  }
  return msg;
}

/** Boots the Vite dev server and resolves once it answers. */
async function startServer() {
  const server = spawn(
    'npx',
    ['vite', '--port', String(PORT), '--strictPort', '--logLevel', 'error'],
    { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('the dev server exited before it was ready');
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return server;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  server.kill();
  throw new Error(`the dev server did not answer on ${BASE} within 60 s`);
}

/** Flips the emulated color scheme and waits out the cross-fade and the tile swap. */
async function setTheme(page, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.waitForLoadState('networkidle').catch(() => {});
  // The basemap swaps to its light_all/dark_all URL and refetches every
  // visible tile — screenshot only once they have all painted, or the freshly
  // themed UI sits on the other theme's map.
  await page
    .waitForFunction(
      () => {
        const tiles = document.querySelectorAll('.leaflet-tile');
        return tiles.length > 0 && [...tiles].every((t) => t.classList.contains('leaflet-tile-loaded'));
      },
      { timeout: 20_000 },
    )
    .catch(() => {});
  // The tiles' own fade-in and the View Transitions cross-fade
  await page.waitForTimeout(2000);
}

/**
 * Screenshots the page in both themes and composites them along a diagonal:
 * light keeps the upper-left, dark the lower-right, with a hairline divider.
 * The PNG is re-encoded losslessly on the way out.
 */
async function shoot(page, locale, name) {
  await setTheme(page, 'light');
  const light = await page.screenshot();
  await setTheme(page, 'dark');
  const dark = await page.screenshot();

  const { width: W, height: H } = await sharp(light).metadata();
  // The split line runs through the center, leaning right: from 62% of the
  // width at the top edge down to 38% at the bottom, so every UI region
  // (header, map, sheet) shows up once per theme.
  const xTop = Math.round(W * 0.62);
  const xBottom = Math.round(W * 0.38);
  const darkSide = Buffer.from(
    `<svg width="${W}" height="${H}"><polygon points="${xTop},0 ${W},0 ${W},${H} ${xBottom},${H}" fill="#fff"/></svg>`,
  );
  const divider = Buffer.from(
    `<svg width="${W}" height="${H}"><line x1="${xTop}" y1="0" x2="${xBottom}" y2="${H}" stroke="rgba(127,127,127,0.9)" stroke-width="6"/></svg>`,
  );
  const darkMasked = await sharp(dark).composite([{ input: darkSide, blend: 'dest-in' }]).toBuffer();

  const path = join(OUT, locale, `${name}.png`);
  await sharp(light)
    .composite([{ input: darkMasked }, { input: divider }])
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path);
  console.log(`✓ ${locale}/${name}.png`);
}

/** Shoots one locale's set inside its own browser context. */
async function shootLocale(browser, locale) {
  const msg = await loadMessages(locale);
  const scene = SCENES[locale];
  await mkdir(join(OUT, locale), { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    locale: CONTEXT_LOCALE[locale],
    timezoneId: 'Europe/Paris',
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
    permissions: ['geolocation'],
    geolocation: { latitude: scene.center.lat, longitude: scene.center.lng },
  });

  try {
    // Skip onboarding, pin the position, the UI language and the scene's
    // departure tank, so the run never depends on the machine's real
    // geolocation or the browser's language.
    await ctx.addInitScript(
      ({ pos, locale, startTankPct }) => {
        localStorage.setItem(
          'plein.settings.v1',
          JSON.stringify({ sourceId: 'auto', onboarded: true, geoGranted: true, lastPos: pos, locale, startTankPct }),
        );
      },
      { pos: scene.center, locale, startTankPct: scene.startTankPct },
    );

    const page = await ctx.newPage();

    // The zone card's headline depends on what has landed: « best choice »
    // needs road distances, « cheapest » stands in before them, each with an
    // in-area variant — any of the four means the zone is on screen.
    const zoneLead = new RegExp(
      [
        msg.sheet_best_choice_nearby,
        msg.sheet_best_choice_in_area,
        msg.sheet_cheapest_nearby,
        msg.sheet_cheapest_in_area,
      ]
        .map(reEscape)
        .join('|'),
    );

    // ── Map screen ──
    await page.goto(BASE);
    await page.getByText(zoneLead).first().waitFor({ timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    // Leaflet keeps painting after the network settles: tiles fade in and the
    // price pins are laid out once their road distances land.
    await page.waitForTimeout(4000);
    if (wanted('map')) await shoot(page, locale, 'map');

    // ── Station detail: the fiche of a well-equipped station ──
    if (wanted('station')) {
      // The map screen leaves the stations of the area in the cache the app reads
      // on a cold boot, so a /station/<id> deep link paints straight away — and
      // that cache is also where we look for a stand-in.
      const target = await page.evaluate(
        async ({ preferred, center, radiusKm }) => {
          // src/data/cacheStore.ts: one record per fetched area under `payloads`
          const stations = await new Promise((resolve) => {
            const req = indexedDB.open('plein.cache');
            req.onerror = () => resolve([]);
            req.onsuccess = () => {
              const db = req.result;
              if (!db.objectStoreNames.contains('payloads')) return resolve([]);
              const all = db.transaction('payloads').objectStore('payloads').getAll();
              all.onsuccess = () => resolve(all.result.flat());
              all.onerror = () => resolve([]);
            };
          });
          if (stations.some((s) => s.id === preferred)) return preferred;
          const km = (a, b) => {
            const rad = (d) => (d * Math.PI) / 180;
            const dLat = rad(b.lat - a.lat);
            const dLng = rad(b.lng - a.lng);
            const h =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
            return 2 * 6371 * Math.asin(Math.sqrt(h));
          };
          // Fuels weigh double: a priced row says more than one more chip.
          let best = null;
          for (const s of stations) {
            const dist = km(center, s);
            if (dist > radiusKm || !s.brand) continue;
            const score = 2 * Object.keys(s.prices ?? {}).length + (s.services?.length ?? 0);
            if (!best || score > best.score || (score === best.score && dist < best.dist)) {
              best = { id: s.id, score, dist };
            }
          }
          return best?.id ?? null;
        },
        { preferred: scene.station ?? null, center: scene.center, radiusKm: 5 },
      );
      if (!target) throw new Error(`no station to shoot the ${locale} fiche on`);
      if (scene.station && target !== scene.station) {
        console.log(`! ${scene.station} absent — falling back to ${target}`);
      }

      await page.goto(`${BASE}/station/${target}`);
      await page.locator(`[aria-label="${msg.detail_map_aria}"]`).waitFor({ timeout: 30_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      await shoot(page, locale, 'station');
    }

    // ── Route screen: the scene's domestic trip ──
    if (wanted('route')) {
      await page.goto(BASE);
      await page.getByText(zoneLead).first().waitFor({ timeout: 60_000 });
      await page.getByText(msg.nav_route, { exact: true }).click();
      // Type the departure rather than leaving the implicit "My position", so
      // the ribbon header names both cities as the README caption does. Same
      // moves as the e2e fixture's pickRoutePlace: on a phone the endpoint
      // field is a trigger button that opens the full-screen place search,
      // whose input carries the field's placeholder — and the row to pick
      // lives under `search-suggestions`, not just anywhere a matching city
      // name is painted.
      // An endpoint is a plain string, or { text, pick } when the typed text
      // is ambiguous across the four geocoders — `pick` is a regex over a
      // whole suggestion row (label then sublabel), not just its first line.
      const pickPlace = async (placeholder, trigger, endpoint) => {
        const { text, pick } = typeof endpoint === 'string' ? { text: endpoint } : endpoint;
        const rowRe = new RegExp(pick ?? `^${reEscape(text)}`);
        const input = page.getByPlaceholder(placeholder);
        if ((await input.count()) === 0) {
          await page.getByRole('button', { name: trigger, exact: true }).click();
          await input.waitFor({ timeout: 10_000 });
        }
        await input.fill(text);
        const row = page
          .getByTestId('search-suggestions')
          .locator('button')
          .filter({ hasText: rowRe })
          .first();
        try {
          await row.click({ timeout: 45_000 });
        } catch {
          // CartoCiudad has spells where it only answers after its timeout —
          // retype to fire a fresh request and give it one more window.
          await input.fill('');
          await input.fill(text);
          await row.click({ timeout: 45_000 });
        }
      };
      await pickPlace(msg.route_from_placeholder, msg.route_from_field_title, scene.from);
      await pickPlace(msg.route_to_placeholder, msg.route_to_field_title, scene.to);
      // Picking the destination submits the trip by itself — no CTA click
      // (route.spec.ts leans on the same behavior). A one-stop plan headlines
      // « Recommended stop », a chained one « Stop 1/2 » — wait for either,
      // with the stop counter's regex built from its own catalog string.
      const stopCounter = reEscape(msg.ribbon_plan_stop_index)
        .replaceAll('\\{index\\}', '\\d+')
        .replaceAll('\\{count\\}', '\\d+');
      const planLabel = new RegExp(`${reEscape(msg.ribbon_recommended_stop)}|${stopCounter}`);
      await page.getByText(planLabel).first().waitFor({ timeout: 60_000 });
      // Expand the sheet so the shot shows the plan's timeline rather than
      // one collapsed row (openRouteSheet in e2e/fixtures.ts, same handle)
      const expand = page.locator(`[aria-label="${msg.route_sheet_expand_aria}"]`);
      if ((await expand.count()) > 0) {
        await expand.click();
        // the sheet's height transition (.3s)
        await page.waitForTimeout(600);
      }
      // The plan lands before the corridor's priced pins are drawn on the
      // route map — wait for at least one price bubble inside it, or the
      // shot shows a bare line between two endpoint dots.
      await page
        .waitForFunction(
          (aria) =>
            (document.querySelector(`[aria-label="${aria}"]`)?.querySelectorAll('.pin-bubble').length ?? 0) > 0,
          msg.map_route_aria,
          { timeout: 60_000 },
        )
        .catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(4000);
      await shoot(page, locale, 'route');
    }
  } finally {
    await ctx.close();
  }
}

const server = await startServer();
// Same escape hatch as playwright.config.ts: sandboxes without the pinned
// browser build point at a system Chromium instead of downloading one.
const browser = await chromium.launch({
  executablePath: process.env.PLEIN_CHROMIUM || undefined,
  headless: !headed,
});
try {
  if (parallel) {
    // One failed locale must not kill the others mid-shot — settle them all,
    // then report and fail the run if any went down.
    const results = await Promise.allSettled(locales.map((locale) => shootLocale(browser, locale)));
    let failures = 0;
    for (const [i, result] of results.entries()) {
      if (result.status === 'rejected') {
        failures += 1;
        console.error(`✗ ${locales[i]}: ${result.reason?.message ?? result.reason}`);
      }
    }
    if (failures) process.exitCode = 1;
  } else {
    for (const locale of locales) {
      await shootLocale(browser, locale);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
