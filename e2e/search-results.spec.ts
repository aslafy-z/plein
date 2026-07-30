import { test, expect, gotoMap, phoneOnly } from './fixtures'

// The place search used to show whatever fitted, capped at a handful of rows.
// Geocoders return a dozen candidates: the panel keeps them all behind a
// scroll, and ranks localities above streets and house numbers — someone
// looking for cheap fuel means the town, not the street of the same name.

test.use({
  seed: { sourceId: 'fra', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

const feature = (label: string, type: string) => ({
  geometry: { coordinates: [1.4442, 43.6047] },
  properties: { label, context: '31, Haute-Garonne, Occitanie', type },
})

// Deliberately upside down: the street first, then addresses, the town last.
const BAN_FEATURES = [
  feature('Rue de Bayonne', 'street'),
  ...Array.from({ length: 8 }, (_, i) => feature(`${i + 1} rue de Bayonne`, 'housenumber')),
  feature('Bayonne', 'municipality'),
]

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', (route) =>
    route.fulfill({
      json: {
        total_count: 1,
        results: [
          {
            id: 'e2e-1',
            ville: 'Toulouse',
            adresse: '1 rue du Test',
            geom: { lat: 43.606, lon: 1.446 },
            gazole_prix: '1.70',
          },
        ],
      },
    }),
  )
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/ban/**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: BAN_FEATURES } }),
  )
})

test('the suggestion list floats over the chips instead of pushing them', async ({ page }) => {
  await gotoMap(page)
  await page.getByLabel('Rechercher un lieu').click()
  const chip = page.getByRole('button', { name: /Filtres/ })
  const before = await chip.boundingBox()

  await page.getByPlaceholder('Ville, adresse…').fill('Bayonne')
  const list = page.getByTestId('search-suggestions')
  await expect(list.getByRole('button', { name: /Itinéraire vers/ }).first()).toBeVisible({
    timeout: 10_000,
  })

  // The list is an overlay: nothing under the bar may move when it appears —
  // on the phone the chips sit right below and used to be shoved down.
  expect(await chip.boundingBox()).toEqual(before)
})

test.describe('phone', () => {
  phoneOnly('full-bleed suggestions are a phone affordance — desktop matches the bar')

  test('the suggestion list spans the whole width', async ({ page, viewport }) => {
    await gotoMap(page)
    await page.getByLabel('Rechercher un lieu').click()
    await page.getByPlaceholder('Ville, adresse…').fill('Bayonne')

    const list = page.getByTestId('search-suggestions')
    await expect(list.getByRole('button', { name: /Itinéraire vers/ }).first()).toBeVisible({
      timeout: 10_000,
    })
    const box = await list.boundingBox()
    expect(box?.x).toBe(0)
    expect(box?.width).toBe(viewport?.width)
  })
})

test('la liste de suggestions défile et place les localités en tête', async ({ page }) => {
  await gotoMap(page)
  await page.getByLabel('Rechercher un lieu').click()
  await page.getByPlaceholder('Ville, adresse…').fill('Bayonne')

  const list = page.getByTestId('search-suggestions')
  const rows = list.getByRole('button', { name: /Itinéraire vers/ })
  await expect(rows.first()).toBeVisible({ timeout: 10_000 })

  // Toutes les suggestions sont rendues — plus que les 5 d'avant.
  await expect(rows).toHaveCount(BAN_FEATURES.length)

  // La commune passe devant la rue, qui passe devant les numéros.
  const labels = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')?.replace('Itinéraire vers ', '') ?? ''),
  )
  expect(labels[0]).toBe('Bayonne')
  expect(labels[1]).toBe('Rue de Bayonne')
  expect(labels[2]).toBe('1 rue de Bayonne')

  // Le panneau est borné : la liste déborde et défile au lieu de couvrir la carte.
  const metrics = await list.evaluate((el) => ({
    overflow: el.scrollHeight - el.clientHeight,
    height: el.clientHeight,
  }))
  expect(metrics.overflow).toBeGreaterThan(0)
  expect(metrics.height).toBeLessThanOrEqual(320)
})
