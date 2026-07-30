import { test, expect, gotoMap, phoneOnly, desktopOnly } from './fixtures'

// The place search used to show whatever fitted, capped at a handful of rows.
// Geocoders return a dozen candidates: the panel keeps them all behind a
// scroll, and ranks localities above streets and house numbers — someone
// looking for cheap fuel means the town, not the street of the same name.
//
// Where they are shown is the arrangement's call: a dropdown attached under
// the bar on a window, the whole screen on a phone.

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

test.describe('window', () => {
  desktopOnly('the dropdown attached under the bar is the desktop arrangement')

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

    // The list is an overlay: nothing under the bar may move when it appears
    expect(await chip.boundingBox()).toEqual(before)
  })

  test('the dropdown is capped and scrolls instead of covering the map', async ({ page }) => {
    await gotoMap(page)
    await page.getByLabel('Rechercher un lieu').click()
    await page.getByPlaceholder('Ville, adresse…').fill('Bayonne')

    const list = page.getByTestId('search-suggestions')
    await expect(list.getByRole('button', { name: /Itinéraire vers/ }).first()).toBeVisible({
      timeout: 10_000,
    })
    const metrics = await list.evaluate((el) => ({
      overflow: el.scrollHeight - el.clientHeight,
      height: el.clientHeight,
    }))
    expect(metrics.overflow).toBeGreaterThan(0)
    expect(metrics.height).toBeLessThanOrEqual(320)
  })
})

test.describe('phone', () => {
  phoneOnly('the full-screen search is a phone arrangement — a window keeps its map')

  // A dropdown floating over the map is the wrong shape once the keyboard
  // takes half the screen: it showed one result and a half, over a map nobody
  // could use anyway. The phone gives the search the whole screen instead.
  test('the search takes the screen and the list fills it', async ({ page, viewport }) => {
    await gotoMap(page)
    await page.getByLabel('Rechercher un lieu').click()
    await page.getByPlaceholder('Ville, adresse…').fill('Bayonne')

    const list = page.getByTestId('search-suggestions')
    await expect(list.getByRole('button', { name: /Itinéraire vers/ }).first()).toBeVisible({
      timeout: 10_000,
    })

    const panel = await page.getByTestId('search-panel').boundingBox()
    expect(panel?.x).toBe(0)
    expect(panel?.y).toBe(0)
    expect(panel?.width).toBe(viewport?.width)
    expect(Math.round(panel?.height ?? 0)).toBe(viewport?.height)

    // The rows run edge to edge and take everything the field leaves
    const box = await list.boundingBox()
    expect(box?.x).toBe(0)
    expect(box?.width).toBe(viewport?.width)
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height)
  })

  test('an unmatched search says so instead of showing a blank screen', async ({ page }) => {
    await page.route('**/proxy/ban/**', (route) =>
      route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
    )
    await gotoMap(page)
    await page.getByLabel('Rechercher un lieu').click()

    // Nothing typed, nothing remembered: what the field is for
    await expect(page.getByText('Cherchez une ville ou une adresse')).toBeVisible()

    await page.getByPlaceholder('Ville, adresse…').fill('Zzzzzz')
    await expect(page.getByText('Aucun lieu ne correspond')).toBeVisible({ timeout: 10_000 })
  })
})

// « Itinéraire › » leaves the search on its own history entry rather than
// popping it: the route setup stacks on top, so Back returns to where the
// destination was picked instead of dropping straight onto the map.
test('back out of the route setup returns to the search', async ({ page }) => {
  await gotoMap(page)
  await page.getByLabel('Rechercher un lieu').click()
  await page.getByPlaceholder('Ville, adresse…').fill('Bayonne')
  await page
    .getByRole('button', { name: 'Itinéraire vers Bayonne' })
    .click({ timeout: 10_000 })
  await expect(page.getByPlaceholder('Ville, adresse…')).toHaveCount(0)

  await page.goBack()
  await expect(page.getByPlaceholder('Ville, adresse…')).toBeVisible()
})

test('la liste de suggestions place les localités en tête', async ({ page }) => {
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

  // La liste défile : elle garde toutes les réponses, quelle que soit la place.
  expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
})
