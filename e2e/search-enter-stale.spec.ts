import { test, expect, gotoMap } from './fixtures'

// Regression: the panel keeps the previous query's suggestions on screen
// through the debounce and the request in flight, and Enter took the top row
// whatever text it answered. Typing « Tou », letting the geocoder answer
// « Toul », then finishing « Toulon » and pressing Enter at once sent the map
// to Toul and wrote Toul into the shared history. Enter now waits for the
// answer to the text actually on screen.

test.use({
  seed: { sourceId: 'fr', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

const feature = (label: string, lat: number, lng: number) => ({
  geometry: { coordinates: [lng, lat] },
  properties: { label, context: 'France', type: 'municipality' },
})

/** How long the geocoder sits on the full query — far past the 300 ms debounce */
const SLOW_ANSWER_MS = 1_500

test('Enter waits for the answer to the text on screen', async ({ page }) => {
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
  // The short query is answered at once, the full one only after a while.
  await page.route('**/proxy/ban/**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    if (q !== 'Toulon') {
      await route.fulfill({
        json: { type: 'FeatureCollection', features: [feature('Toul', 48.675, 5.891)] },
      })
      return
    }
    await new Promise((r) => setTimeout(r, SLOW_ANSWER_MS))
    await route
      .fulfill({
        json: { type: 'FeatureCollection', features: [feature('Toulon', 43.1242, 5.928)] },
      })
      .catch(() => {})
  })

  await gotoMap(page)
  await page.getByLabel('Search for a place').click()
  const input = page.getByPlaceholder('Town, address…')
  await input.fill('Tou')
  const list = page.getByTestId('search-suggestions')
  await expect(list.getByRole('button', { name: 'Directions to Toul', exact: true })).toBeVisible({
    timeout: 10_000,
  })

  // Finish the word and press Enter while « Toul » is still the only row
  await input.fill('Toulon')
  await input.press('Enter')

  // The pick lands with its own answer and closes the search…
  await expect(input).toHaveCount(0, { timeout: 10_000 })

  // …on the town that was typed: the leftover row never reached the history
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (JSON.parse(localStorage.getItem('plein.settings.v1') ?? '{}').searchHistory ??
            []) as { label: string }[]
        ).map((p) => p.label),
      ),
    )
    .toEqual(['Toulon'])
})
