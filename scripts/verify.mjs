// E2E verification: drives every flow of Plein. and captures screenshots.
// Usage: node scripts/verify.mjs [baseUrl] [outDir]
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = process.argv[3] ?? 'shots';
mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
};

// Use the system-provided Chromium when the pinned Playwright build is absent
const executablePath = process.env.PLEIN_CHROMIUM ?? undefined;

async function run(label, contextOpts, { demo = true } = {}) {
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/net::|Failed to load resource|ERR_/.test(m.text()))
      errors.push(m.text());
  });

  const shot = (name) =>
    page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: false });

  // Fresh profile; optionally force demo source for deterministic offline runs
  await page.addInitScript((useDemo) => {
    localStorage.clear();
    if (useDemo)
      localStorage.setItem(
        'plein.settings.v1',
        JSON.stringify({ sourceId: 'demo' }),
      );
  }, demo);

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // ── Onboarding ──
  ok(`${label}: onboarding headline`, await page.getByText('Payez votre plein au juste prix.').isVisible());
  await shot('01-onboarding');
  await page.getByText('Continuer sans localisation').click();

  // ── Map ──
  await page.waitForTimeout(1600); // stations load (+fallback if needed)
  ok(`${label}: map search bar`, await page.getByText('Où allez-vous ?').isVisible());
  const cheapSheet = await page.getByText('La moins chère près de vous').isVisible().catch(() => false);
  ok(`${label}: cheapest bottom sheet`, cheapSheet);
  await shot('02-map');

  // fuel cycle chip
  await page.getByText('Gazole ↻').click();
  ok(`${label}: fuel cycled to SP95-E10`, await page.getByText('SP95-E10 ↻').isVisible());
  await page.getByText('SP95-E10 ↻').click();
  await page.getByText('E85 ↻').click(); // back to Gazole

  // ── Filters ──
  await page.getByText(/^Filtres · \d+$/).click();
  await page.waitForTimeout(300);
  ok(`${label}: filters sheet`, await page.getByText('Rayon de recherche', { exact: false }).isVisible());
  await shot('03-filters');
  await page.getByText(/^Voir \d+ stations?$/).click();
  await page.waitForTimeout(300);

  // ── Detail from map sheet ──
  if (cheapSheet) {
    await page.getByText(/^MàJ|· ouvert ·/).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const detailVisible = await page.getByText('photo de la station').isVisible().catch(() => false);
    ok(`${label}: station detail opens`, detailVisible);
    await shot('04-detail');
    if (detailVisible) await page.getByRole('button', { name: /retour|←/i }).first().click().catch(() => page.getByText('←').click());
    await page.waitForTimeout(300);
  }

  // ── List ──
  await page.getByText('Liste', { exact: true }).click();
  await page.waitForTimeout(400);
  ok(`${label}: list hero`, await page.getByText('Votre économie possible').isVisible());
  ok(`${label}: list rows`, await page.getByText('meilleur prix').first().isVisible().catch(() => false));
  await shot('05-list');
  await page.getByText('Distance', { exact: true }).click();
  await page.waitForTimeout(200);

  // ── Route setup ──
  await page.getByText('Trajet', { exact: true }).click();
  await page.waitForTimeout(300);
  ok(`${label}: route setup`, await page.getByText('Comparez les prix le long de votre trajet').isVisible());
  await shot('06-route-setup');
  await page.getByText('Bordeaux centre').click(); // recent
  await page.waitForTimeout(200);
  await page.getByText('Comparer les stations sur le trajet').click();
  await page.waitForTimeout(2500); // route + stations along

  // ── Route ribbon ──
  const ribbonOk = await page.getByText('Arrêt conseillé', { exact: false }).isVisible().catch(() => false);
  ok(`${label}: route ribbon reco`, ribbonOk);
  await shot('07-route-ribbon');
  if (ribbonOk) {
    // strategy switch
    await page.getByText('Prix le + bas').click();
    await page.waitForTimeout(300);
    await shot('08-route-prix');
    // add reco to tour
    await page.getByRole('button', { name: 'Ajouter à la tournée' }).first().click().catch(async () => {
      await page.getByText('+', { exact: true }).first().click();
    });
    await page.waitForTimeout(300);
    const tourBar = await page.getByText('Ouvrir la tournée dans Maps ›').isVisible().catch(() => false);
    ok(`${label}: tour bar appears`, tourBar);
    await shot('09-route-tour');
  }

  // ── Settings ──
  await page.getByText('Réglages', { exact: true }).click();
  await page.waitForTimeout(300);
  ok(`${label}: settings`, await page.getByText('Carburant par défaut').isVisible());
  ok(`${label}: source selector`, await page.getByText('prix-carburants.gouv.fr').isVisible());
  await shot('10-settings');

  // tank slider affects savings — set to 80 and check list hero changes
  const slider = page.locator('input[type=range]').first();
  await slider.fill('80');
  await page.getByText('Liste', { exact: true }).click();
  await page.waitForTimeout(300);
  ok(`${label}: hero shows 80 L`, await page.getByText('sur un plein de 80 L').isVisible());

  ok(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

const mobile = devices['Pixel 7'];
await run('mobile', { ...mobile, locale: 'fr-FR' });
await run('desktop', { viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
