import { test, expect, gotoMap } from './fixtures'

// The tier scale is computed over ALL the stations drawn on the map (the
// whole loaded area), not just the search circle. A sparse circle used to
// degenerate the scale: one lone station inside it made min = max = mean,
// so every pin on screen within 1 ct of its price turned green — and a
// small pan flipped the same stations between red and green.

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

  // Tiers judged on the whole map: only the two cheapest are « bons plans »
  await expect(page.locator('.pin-bubble--deal')).toHaveCount(2)
  await expect(page.locator('.pin-bubble--deal', { hasText: '1,80' })).toHaveCount(1)
  await expect(page.locator('.pin-bubble--deal', { hasText: '1,81' })).toHaveCount(1)

  // The lone in-circle station is no bargain — it must stay neutral
  const near = page.locator('.pin-bubble', { hasText: '2,05' })
  await expect(near).toHaveCount(1)
  await expect(near).not.toHaveClass(/pin-bubble--deal/)
  await expect(near).not.toHaveClass(/pin-bubble--high/)

  // The area's priciest station keeps its orange tint
  await expect(page.locator('.pin-bubble--high')).toHaveCount(1)
  await expect(page.locator('.pin-bubble--high', { hasText: '2,10' })).toHaveCount(1)
})
