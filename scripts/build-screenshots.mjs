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
// Usage: npm run build:screenshots
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
const browser = await chromium.launch();
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
  await shoot(page, 'map');

  // ── Station detail: tapping the card in the sheet opens the fiche ──
  await page.getByText(/MàJ /).first().click();
  await page.locator('[aria-label="Carte de la station"]').waitFor({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  // The fiche is shorter than the viewport for a station with few services —
  // clip it just under the CTA so the README row doesn't show dead space.
  const cta = await page.getByRole('button', { name: 'Y aller' }).first().boundingBox();
  await shoot(page, 'station', {
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.ceil(cta.y + cta.height + 20) },
  });
  await page.goBack();

  // ── Route screen: Toulouse → Nantes ──
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
} finally {
  await browser.close();
  server.kill();
}
