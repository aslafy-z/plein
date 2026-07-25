// Regenerates docs/screenshots/*.png — the two screenshots the README embeds.
//
// The shots are taken against the LIVE sources (`sourceId: 'auto'`), not the
// deterministic demo dataset: real prices, real station names and a real OSRM
// corridor are the point of these images, so every run produces the prices of
// the day. Both screens start from Toulouse and the trip is Toulouse → Nantes,
// matching the captions in the README.
//
// The viewport is 480×1064 at DPR 3 (1440×3192), which the README displays at
// width 300. That width is deliberate: the map auto-fit frames the search
// circle into the viewport and snaps to an integer zoom, so a narrower phone
// (390 or 430 CSS px) lands one level further out and packs the price bubbles
// of a dense centre on top of each other. PNGs are re-encoded losslessly
// afterwards — Chromium's own encoder leaves roughly 45% on the table.
// Usage: npm run build:screenshots [map] [station] [route]
// Naming shots regenerates only those — handy to refresh the fiche without
// reshooting the map and the trip with the prices of another day.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs/screenshots');
// A dedicated port so a dev server already running on 5173 is left alone
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const TOULOUSE = { lat: 43.6047, lng: 1.4442 };
const VIEWPORT = { width: 480, height: 1064 };

// The fiche the README shows off has to have something to show. Tapping the
// recommended card lands on whichever station is cheapest today, and the gouv
// flux leaves plenty of them with three fuels and « Aucun service renseigné »
// under half an empty screen. This one is a Total Access in Toulouse: GPLc on
// top of the usual pumps, nine services, and an enseigne the mini-map has a
// logo for. Should it ever leave the flux, the richest loaded station stands in.
const STATION_ID = 'fra-31100010';

const SHOTS = ['map', 'station', 'route'];
const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !SHOTS.includes(n));
if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(', ')} — expected ${SHOTS.join(', ')}`);
const wanted = (name) => asked.length === 0 || asked.includes(name);

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

/** Screenshots the page, then re-encodes the PNG losslessly. */
async function shoot(page, name, opts = {}) {
  const buf = await page.screenshot(opts);
  const path = join(OUT, `${name}.png`);
  await sharp(buf).png({ compressionLevel: 9, effort: 10 }).toFile(path);
  console.log(`✓ ${name}.png`);
}

const server = await startServer();
// Same escape hatch as playwright.config.ts: sandboxes without the pinned
// browser build point at a system Chromium instead of downloading one.
const browser = await chromium.launch({
  executablePath: process.env.PLEIN_CHROMIUM || undefined,
});
try {
  await mkdir(OUT, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    colorScheme: 'dark',
    isMobile: true,
    hasTouch: true,
    permissions: ['geolocation'],
    geolocation: { latitude: TOULOUSE.lat, longitude: TOULOUSE.lng },
  });

  // Skip onboarding and pin the position, so the run never depends on the
  // machine's real geolocation.
  await ctx.addInitScript((pos) => {
    localStorage.setItem(
      'plein.settings.v1',
      JSON.stringify({ sourceId: 'auto', onboarded: true, geoGranted: true, lastPos: pos }),
    );
  }, TOULOUSE);

  const page = await ctx.newPage();

  // ── Map screen ──
  await page.goto(BASE);
  await page.getByText('Le meilleur choix près de vous').waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  // Leaflet keeps painting after the network settles: tiles fade in and the
  // price pins are laid out once their road distances land.
  await page.waitForTimeout(4000);
  if (wanted('map')) await shoot(page, 'map');

  // ── Station detail: the fiche of a well-equipped station ──
  if (wanted('station')) {
    // The map screen leaves the stations of the area in the cache the app reads
    // on a cold boot, so a /station/<id> deep link paints straight away — and
    // that cache is also where we look for a stand-in.
    const target = await page.evaluate(
      ({ preferred, center, radiusKm }) => {
        const entries = JSON.parse(localStorage.getItem('plein.stations.cache.v2') ?? '[]');
        const stations = entries.flatMap((e) => e.stations ?? []);
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
      { preferred: STATION_ID, center: TOULOUSE, radiusKm: 5 },
    );
    if (!target) throw new Error('no station to shoot the fiche on');
    if (target !== STATION_ID) console.log(`! ${STATION_ID} absent — falling back to ${target}`);

    await page.goto(`${BASE}/station/${target}`);
    await page.locator('[aria-label="Carte de la station"]').waitFor({ timeout: 30_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    await shoot(page, 'station');
  }

  // ── Route screen: Toulouse → Nantes ──
  if (wanted('route')) {
    await page.goto(BASE);
    await page.getByText('Le meilleur choix près de vous').waitFor({ timeout: 60_000 });
    await page.getByText('Trajet', { exact: true }).click();
    // Type the departure rather than leaving the implicit "Ma position", so the
    // ribbon header reads "Toulouse → Nantes" as the README caption says.
    await page.locator('input[placeholder="Départ"]').fill('Toulouse');
    await page.getByText(/^Toulouse/).first().click({ timeout: 30_000 });
    await page.locator('input[placeholder="Destination"]').fill('Nantes');
    await page.getByText(/^Nantes/).first().click({ timeout: 30_000 });
    await page.getByText('Comparer les stations sur le trajet').click();
    await page.getByText('Arrêt conseillé').waitFor({ timeout: 60_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(4000);
    await shoot(page, 'route');
  }
} finally {
  await browser.close();
  server.kill();
}
