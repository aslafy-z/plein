import { test, expect, gotoMap } from './fixtures'

// Dense areas: only the PIN_CAP (15) cheapest stations wear a price bubble on
// the map; the rest shrink to small dots (still tappable) and a passive chip
// says how many. Selecting a dot promotes it to a full price pin.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

const TOTAL = 22
const CAP = 15

test.beforeEach(async ({ page }) => {
  // Deterministic gouv flux: TOTAL stations ringed around the queried center,
  // prices strictly increasing so the « cheapest » ordering is unambiguous.
  await page.route('**/proxy/gouv/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = Array.from({ length: TOTAL }, (_, i) => {
      const angle = (2 * Math.PI * i) / TOTAL
      return {
        id: `e2e-${i}`,
        ville: 'Testville',
        adresse: `${i} rue du Test`,
        geom: { lat: lat + 0.015 * Math.sin(angle), lon: lng + 0.02 * Math.cos(angle) },
        gazole_prix: (1.6 + i * 0.01).toFixed(2),
      }
    })
    await route.fulfill({ json: { total_count: TOTAL, results } })
  })
  // Brand enrichment is irrelevant here — keep it deterministic and instant
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await gotoMap(page)
})

test('a dense area shows the 15 cheapest as price pins, the rest as dots', async ({ page }) => {
  const bubbles = page.locator('.pin-bubble')
  const dots = page.locator('.pin-dot')

  await expect(bubbles).toHaveCount(CAP)
  await expect(dots).toHaveCount(TOTAL - CAP)

  // The most expensive station has no price bubble on the map
  const dearest = (1.6 + (TOTAL - 1) * 0.01).toFixed(2).replace('.', ',')
  await expect(page.locator('.pin-bubble', { hasText: dearest })).toHaveCount(0)

  // The passive chip announces what is hidden behind the dots
  await expect(page.getByTestId('pin-cap-hint')).toContainText(
    `Les ${CAP} moins chères · ${TOTAL - CAP} en points`,
  )

  // Tapping a dot selects the station and promotes it to a full price pin
  await dots.first().click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible()
  await expect(bubbles).toHaveCount(CAP + 1)
  await expect(dots).toHaveCount(TOTAL - CAP - 1)
})
