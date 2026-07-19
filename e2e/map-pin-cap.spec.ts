import { test, expect, gotoMap } from './fixtures'

// Dense areas: only the PIN_CAP (15) cheapest stations wear a price bubble on
// the map — those inside the search circle first — the rest shrink to small
// dots (still tappable) and a passive chip says how many. Selecting a dot
// promotes it to a full price pin.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

const FAR = 4 // the FAR cheapest stations sit OUTSIDE the 5 km circle
const NEAR = 18 // stations inside the circle, all pricier than the far ones
const TOTAL = FAR + NEAR
const CAP = 15

test.beforeEach(async ({ page }) => {
  // Deterministic gouv flux: prices strictly increase with the index, and the
  // cheapest FAR stations are placed ~7 km out — beyond the default 5 km
  // radius but inside the fetched area — so the circle-priority is observable.
  await page.route('**/proxy/gouv/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = Array.from({ length: TOTAL }, (_, i) => {
      const far = i < FAR
      const angle = far ? (Math.PI / 2) * (1 + 2 * i) : (2 * Math.PI * i) / NEAR
      const dLat = far ? 0.063 * Math.sin(angle) : 0.015 * Math.sin(angle)
      const dLng = far ? 0.085 * Math.cos(angle) : 0.02 * Math.cos(angle)
      return {
        id: `e2e-${i}`,
        ville: 'Testville',
        adresse: `${i} rue du Test`,
        geom: { lat: lat + dLat, lon: lng + dLng },
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

test('a dense zone shows its 15 cheapest as price pins, the rest as dots', async ({ page }) => {
  const bubbles = page.locator('.pin-bubble')
  const dots = page.locator('.pin-dot')

  await expect(bubbles).toHaveCount(CAP)
  await expect(dots).toHaveCount(TOTAL - CAP)

  // Circle priority: the map's cheapest stations sit OUTSIDE the circle and
  // still get NO bubble — all 15 bubbles belong to in-zone stations, whose
  // cheapest (index FAR) is the highlighted best pin.
  for (let i = 0; i < FAR; i++) {
    const price = (1.6 + i * 0.01).toFixed(2).replace('.', ',')
    await expect(page.locator('.pin-bubble', { hasText: price })).toHaveCount(0)
  }
  const bestZonePrice = (1.6 + FAR * 0.01).toFixed(2).replace('.', ',')
  await expect(page.locator('.pin-bubble', { hasText: bestZonePrice })).toBeVisible()

  // The passive chip counts the ZONE (the circle), like every other count in
  // the app — the 4 far dots and the rest of the fetched area must not
  // inflate it: 18 in-zone stations → 15 bubbles + 3 dots.
  await expect(page.getByTestId('pin-cap-hint')).toContainText(
    `Zone : les ${CAP} moins chères · ${NEAR - CAP} en points`,
  )

  // Tapping a dot selects the station and promotes it to a full price pin
  // (the last dot is an in-zone one — the far ones may sit outside the view)
  await dots.last().click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible()
  await expect(bubbles).toHaveCount(CAP + 1)
  await expect(dots).toHaveCount(TOTAL - CAP - 1)
})
