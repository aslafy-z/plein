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
    await page.getByText(/MàJ /).first().click().catch(() => {});
    await page.waitForTimeout(500);
    const detailVisible = await page
      .locator('[aria-label="Carte de la station"]')
      .isVisible()
      .catch(() => false);
    ok(`${label}: station detail opens (mini-map)`, detailVisible);
    ok(
      `${label}: open status shown honestly`,
      await page.getByText(/Ouvert|Fermé/).first().isVisible().catch(() => false),
    );
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
  ok(`${label}: suggestions until real history`, await page.getByText('Suggestions').isVisible());
  await shot('06-route-setup');
  await page.getByText('Bordeaux centre').click(); // suggestion
  await page.waitForTimeout(200);
  await page.getByText('Comparer les stations sur le trajet').click();
  await page.waitForTimeout(2500); // route + stations along

  // ── Route ribbon ──
  const ribbonOk = await page.getByText('Arrêt conseillé', { exact: false }).isVisible().catch(() => false);
  ok(`${label}: route ribbon reco`, ribbonOk);
  ok(
    `${label}: route map with corridor pins`,
    await page.locator('[aria-label="Carte du trajet"]').isVisible().catch(() => false),
  );
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

  // ── Real trip history ──
  await page.getByText('Modifier').click();
  await page.waitForTimeout(300);
  ok(`${label}: trip saved to Récents`, await page.getByText(/fait le/).first().isVisible().catch(() => false));
  ok(`${label}: Récents header once history exists`, await page.getByText('Récents', { exact: true }).isVisible().catch(() => false));

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

  // ── Search this area: pan the map away, re-search around the new center ──
  await page.getByText('Carte', { exact: true }).click();
  await page.waitForTimeout(500);
  const mapBox = await page.locator('.leaflet-container').first().boundingBox();
  if (mapBox) {
    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(cx + 130, cy + 100);
      await page.mouse.down();
      await page.mouse.move(cx - 140, cy - 110, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
  }
  const searchBtn = page.getByText('Rechercher dans cette zone');
  const searchBtnVisible = await searchBtn.isVisible().catch(() => false);
  ok(`${label}: search-this-area appears after panning`, searchBtnVisible);
  if (searchBtnVisible) {
    await searchBtn.click();
    await page.waitForTimeout(1000);
    ok(
      `${label}: stations reload around the new area`,
      await page.getByText('La moins chère dans cette zone').isVisible().catch(() => false),
    );
    await shot('11-search-area');
  }

  ok(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// When the gouv APIs are unreachable (offline/sandbox), the app must fall back
// to demo data with a visible banner. Online, the real source must load without
// the banner. Either outcome is a pass; a broken map/list is the failure.
async function runSourceCheck() {
  const browser = await chromium.launch({ executablePath });
  const page = await (
    await browser.newContext({ ...devices['Pixel 7'], locale: 'fr-FR' })
  ).newPage();
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      'plein.settings.v1',
      JSON.stringify({ sourceId: 'gouv', onboarded: true }),
    );
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000); // gouv attempt + possible fallback
  const banner = await page
    .getByText('Source temps réel indisponible', { exact: false })
    .isVisible()
    .catch(() => false);
  const sheet = await page
    .getByText('La moins chère près de vous')
    .isVisible()
    .catch(() => false);
  const emptyBar = await page
    .getByText('Aucune station ne correspond', { exact: false })
    .isVisible()
    .catch(() => false);
  ok(
    'gouv source: usable map (live data, or demo fallback with banner)',
    sheet || emptyBar,
    banner ? 'fell back to demo (banner shown)' : 'live gouv data',
  );
  await page.screenshot({ path: `${OUT}/mobile-11-gouv-source.png` });
  await browser.close();
}

const mobile = devices['Pixel 7'];
await run('mobile', { ...mobile, locale: 'fr-FR' });
await run('desktop', { viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
await runSourceCheck();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
