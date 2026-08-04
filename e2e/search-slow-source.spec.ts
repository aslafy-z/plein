import { test, expect } from './fixtures'

// Regression: when one of the « Automatic » mode's geocoders turns very
// slow (CartoCiudad has spells of 7 s and more per request), the whole
// search stayed silent until its timeout — the user saw a dead search even
// though the BAN had answered within a second. Suggestions must appear as
// soon as one source has results.
test.use({
  seed: { sourceId: 'auto', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

test('suggestions do not wait for the slowest source', async ({ page }) => {
  await page.route('**/proxy/fra/**', (route) =>
    route.fulfill({ json: { total_count: 0, results: [] } }),
  )
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/ban/**', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { coordinates: [1.4442, 43.6047] },
            properties: { label: 'Toulouse', context: '31, Haute-Garonne, Occitanie' },
          },
        ],
      },
    }),
  )
  await page.route('**/proxy/and/**', (route) => route.fulfill({ json: { suggestions: [] } }))
  await page.route('**/proxy/photon/**', (route) =>
    route.fulfill({ json: { type: 'FeatureCollection', features: [] } }),
  )
  // CartoCiudad in full lethargy: nothing before 20 s.
  await page.route('**/proxy/cartociudad/**', async (route) => {
    await new Promise((r) => setTimeout(r, 20_000))
    await route.fulfill({ json: [] }).catch(() => {})
  })

  await page.goto('/')
  await expect(page.getByLabel('Search for a place')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill('Toulouse')

  // BAN answers at once: its results show without waiting for Spain, well
  // before its 20 s.
  await expect(page.getByText('see the stations here').first()).toBeVisible({ timeout: 6_000 })

  // …and the spinner still turns, because a source has not concluded: the
  // list may still grow.
  await expect(page.getByRole('status', { name: 'Searching…' })).toBeVisible()
})
