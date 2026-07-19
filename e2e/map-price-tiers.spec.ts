import { test, expect, gotoMap } from './fixtures'

// Pin & dot colors follow the zone's price tiers: the « bon plan » tier
// (within 1 ct of the cheapest, widened to a quarter of the cheapest→average
// gap) is green — SEVERAL stations at near-identical low prices are all
// highlighted, not just the first — and the priciest tier is tinted orange.
// The collapsed sheet still preselects a single station; expanding the list
// shows every bon plan highlighted with its own label.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

// mean ≈ 1.732 → dealMax ≈ 1.633 (3 deals) ; highMin ≈ 1.820 (2 high)
const PRICES = [1.6, 1.61, 1.62, 1.75, 1.76, 1.77, 1.78, 1.85, 1.85]
const DEALS = 3
const HIGHS = 2

test.beforeEach(async ({ page }) => {
  // Deterministic gouv flux around the searched point: a cluster of three
  // near-identical low prices, a mid pack, and two stations hugging the max.
  await page.route('**/proxy/gouv/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = PRICES.map((p, i) => {
      const angle = (2 * Math.PI * i) / PRICES.length
      return {
        id: `e2e-${i}`,
        ville: 'Testville',
        adresse: `${i} rue du Test`,
        geom: { lat: lat + 0.012 * Math.sin(angle), lon: lng + 0.016 * Math.cos(angle) },
        gazole_prix: p.toFixed(3),
      }
    })
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  // Brand enrichment is irrelevant here — keep it deterministic and instant
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await gotoMap(page)
})

test('pin colors follow the price tiers of the zone', async ({ page }) => {
  await expect(page.locator('.pin-bubble')).toHaveCount(PRICES.length)
  await expect(page.locator('.pin-bubble--deal')).toHaveCount(DEALS)
  await expect(page.locator('.pin-bubble--high')).toHaveCount(HIGHS)

  // The green tier is the low-price cluster, the orange one hugs the max
  for (const p of PRICES.slice(0, DEALS)) {
    await expect(
      page.locator('.pin-bubble--deal', { hasText: p.toFixed(2).replace('.', ',') }),
    ).toHaveCount(PRICES.slice(0, DEALS).filter((x) => x === p).length)
  }
  await expect(page.locator('.pin-bubble--high', { hasText: '1,85' })).toHaveCount(HIGHS)
})

test('the sheet preselects one station, the expanded list highlights every bon plan', async ({
  page,
}) => {
  // Collapsed: a single preselected card — the cheapest of the zone
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
  await expect(page.getByText('1,60 €').first()).toBeVisible()

  await page.getByRole('button', { name: /liste des stations/ }).click()
  await expect(page.getByText(`${DEALS} bons plans`)).toBeVisible()
  // The cheapest keeps its label; its near-equals are flagged as bons plans
  await expect(page.getByText('meilleur prix')).toHaveCount(1)
  await expect(page.getByText('bon plan · +0,01')).toBeVisible()
  await expect(page.getByText('bon plan · +0,02')).toBeVisible()
  await expect(page.getByText(/^bon plan/)).toHaveCount(DEALS - 1)
})
