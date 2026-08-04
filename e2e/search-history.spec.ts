import { test, expect, gotoMap } from './fixtures'

// Fuel searches repeat: the map's place search remembers where it has been
// sent. Opening it offers the history before a single key is pressed, and
// typing ranks the matching entries above the geocoder's own answers.

const point = { lat: 43.6047, lng: 1.4442 }
const SEED = { sourceId: 'fr', onboarded: true, lastPos: point }

const remembered = (label: string, at: number) => ({
  label,
  sublabel: 'Gironde',
  point,
  kind: 'locality',
  at,
})

const feature = (label: string, type: string) => ({
  geometry: { coordinates: [point.lng, point.lat] },
  properties: { label, context: '31, Haute-Garonne, Occitanie', type },
})

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fr/**', (route) =>
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
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/ban/**', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [feature('Bordères', 'municipality'), feature('Rue de Bordeaux', 'street')],
      },
    }),
  )
})

/**
 * Labels of the panel rows, in order — each row's « Directions to X »
 * shortcut names it. The expected count is awaited first: the geocoder answers
 * after the remembered places are already on screen.
 */
async function rowLabels(page: import('@playwright/test').Page, count: number) {
  const rows = page.getByTestId('search-suggestions').getByRole('button', {
    name: /Directions to/,
  })
  await expect(rows).toHaveCount(count, { timeout: 10_000 })
  return rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')?.replace('Directions to ', '') ?? ''),
  )
}

test.describe('with places already searched', () => {
  test.use({
    seed: {
      ...SEED,
      searchHistory: [
        remembered('Annecy', 1_700_000_000_000),
        remembered('Bordeaux centre', 1_700_000_100_000),
      ],
    },
  })

  test('an empty query offers the remembered places, most recent first', async ({ page }) => {
    await gotoMap(page)
    await page.getByLabel('Search for a place').click()

    const list = page.getByTestId('search-suggestions')
    await expect(list).toBeVisible()
    await expect(list.getByText('Recent')).toBeVisible()
    expect(await rowLabels(page, 2)).toEqual(['Bordeaux centre', 'Annecy'])

    // Told apart from a geocoder hit. How much room the panel takes is the
    // arrangement's business — search-results.spec.ts holds it.
    await expect(list.getByRole('img', { name: 'Previously searched place' })).toHaveCount(2)
  })

  test('a matching remembered place outranks the geocoder answers', async ({ page }) => {
    await gotoMap(page)
    await page.getByLabel('Search for a place').click()
    await page.getByPlaceholder('Town, address…').fill('Bord')

    // The history first, then what the geocoder found — Annecy matches nothing.
    expect(await rowLabels(page, 3)).toEqual([
      'Bordeaux centre',
      'Bordères',
      'Rue de Bordeaux',
    ])
  })

  test('picking a remembered place moves the search circle there', async ({ page }) => {
    await gotoMap(page)
    await page.getByLabel('Search for a place').click()
    await page.getByTestId('search-suggestions').getByText('Bordeaux centre').click()

    await expect(page.getByLabel('Search for a place')).toContainText('Bordeaux centre')
  })
})

test.describe('with nothing searched yet', () => {
  test.use({ seed: SEED })

  test('an empty query shows no panel at all', async ({ page }) => {
    await gotoMap(page)
    await page.getByLabel('Search for a place').click()
    await expect(page.getByPlaceholder('Town, address…')).toBeFocused()
    await expect(page.getByTestId('search-suggestions')).toHaveCount(0)
  })

  test('a picked place survives a reload and comes back on the next search', async ({ page }) => {
    await gotoMap(page)
    await page.getByLabel('Search for a place').click()
    await page.getByPlaceholder('Town, address…').fill('Bord')
    expect(await rowLabels(page, 2)).toEqual(['Bordères', 'Rue de Bordeaux'])

    await page.getByTestId('search-suggestions').getByText('Bordères').click()
    await expect(page.getByLabel('Search for a place')).toContainText('Bordères')

    // Persisted with the other settings, so it is still there after a reload
    await gotoMap(page)
    await page.getByLabel('Search for a place').click()
    await expect(page.getByTestId('search-suggestions').getByText('Recent')).toBeVisible()
    expect(await rowLabels(page, 1)).toEqual(['Bordères'])
  })
})
