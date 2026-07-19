import { test, expect, gotoMap } from './fixtures'

// The tier scale is computed over ALL the stations drawn on the map (the
// whole loaded area), not just the search circle. A sparse circle used to
// degenerate the scale: one lone station inside it made min = max = mean,
// so every pin on screen within 1 ct of its price turned green — and a
// small pan flipped the same stations between red and green.
// In-zone stations keep one privilege: the circle's cheapest (± 1 ct) is
// always a « bon plan » — its pin must agree with the green « la moins
// chère dans cette zone » card — without repainting out-of-circle pins.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

// In the circle (default radius 5 km): a single station at 2.05.
// Out of the circle but on the map (~11 km away): 1.80/1.81 (deals),
// 1.90 (mid) and 2.10 (high).
// Area-wide: mean = 1.932 → dealMax ≈ 1.833 ; highMin ≈ 2.058.
// Circle-only stats would instead make EVERY price ≤ 2.06 a « deal ».
const NEAR = [2.05]
const FAR = [1.8, 1.81, 1.9, 2.1]

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const station = (p: number, i: number, latOff: number, lngOff: number) => ({
      id: `e2e-area-${p}-${i}`,
      ville: 'Testville',
      adresse: `${i} rue du Test`,
      geom: { lat: lat + latOff, lon: lng + lngOff },
      gazole_prix: p.toFixed(3),
    })
    const results = [
      ...NEAR.map((p, i) => station(p, i, 0.002, 0.002)),
      // ~0.1° ≈ 11 km: outside the 5 km circle, inside the loaded area
      ...FAR.map((p, i) => station(p, i, 0.1, 0.02 * i)),
    ]
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await gotoMap(page)
})

test('a lone station in the circle does not turn the whole map green', async ({ page }) => {
  await expect(page.locator('.pin-bubble')).toHaveCount(NEAR.length + FAR.length)

  // Tiers judged on the whole map, PLUS the zone floor: the two area-wide
  // bargains and the circle's own cheapest — the card's station — are green
  await expect(page.locator('.pin-bubble--deal')).toHaveCount(3)
  await expect(page.locator('.pin-bubble--deal', { hasText: '1,80' })).toHaveCount(1)
  await expect(page.locator('.pin-bubble--deal', { hasText: '1,81' })).toHaveCount(1)
  await expect(page.locator('.pin-bubble--deal', { hasText: '2,05' })).toHaveCount(1)

  // The out-of-circle mid pack must NOT inherit the lone station's scale
  const farMid = page.locator('.pin-bubble', { hasText: '1,90' })
  await expect(farMid).toHaveCount(1)
  await expect(farMid).not.toHaveClass(/pin-bubble--deal/)
  await expect(farMid).not.toHaveClass(/pin-bubble--high/)

  // The area's priciest station keeps its orange tint
  await expect(page.locator('.pin-bubble--high')).toHaveCount(1)
  await expect(page.locator('.pin-bubble--high', { hasText: '2,10' })).toHaveCount(1)
})

test("the circle's cheapest pin is green like its « moins chère » card", async ({ page }) => {
  // The collapsed card crowns the in-circle station…
  await expect(page.getByText('2,05 €').first()).toBeVisible()
  // …and its pin wears the same green, even though the area holds cheaper
  await expect(page.locator('.pin-bubble--deal', { hasText: '2,05' })).toHaveCount(1)
})
