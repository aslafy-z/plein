import { test, expect, gotoMap } from './fixtures'

// The place search says it is working: a spinner sits at the right of the
// input from the first keystroke (the debounce included) until the geocoder
// answers, then disappears with the suggestions.

test.use({
  seed: { sourceId: 'fra', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

test('a loading indicator spins while the place search runs', async ({ page }) => {
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
  // A geocoder that takes its time — long enough for the spinner to be observable
  await page.route('**/proxy/ban/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1_500))
    await route
      .fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            {
              geometry: { coordinates: [1.4442, 43.6047] },
              properties: { label: 'Toulouse', context: '31, Haute-Garonne, Occitanie' },
            },
          ],
        },
      })
      .catch(() => {})
  })

  await gotoMap(page)
  await page.getByLabel('Search for a place').click()

  const spinner = page.getByRole('status', { name: 'Searching…' })
  await expect(spinner).toBeHidden()

  await page.getByPlaceholder('Town, address…').fill('Toulouse')
  await expect(spinner).toBeVisible()

  await expect(page.getByText('see the stations here').first()).toBeVisible({ timeout: 10_000 })
  await expect(spinner).toBeHidden()
})
