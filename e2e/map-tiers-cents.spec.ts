import { test, expect, gotoMap } from './fixtures'

// Tiers are judged at DISPLAYED precision (cents). The raw « bon plan »
// threshold can fall inside a cent — here dealMax ≈ 1,9001 — and used to
// split two stations both reading « 1,90 € » into one green (1,896) and
// one gray (1,904). Same displayed price must mean same tier, and the
// displayed deltas must match the displayed prices too.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

// All within the default 5 km radius. mean = 1,9844 → dealMax ≈ 1,9001 ;
// highMin ≈ 2,1086. The two « 1,90 » straddle the raw threshold.
const STATIONS = [
  { id: 'e2e-min', ville: 'Minville', off: 0.01, prix: '1.872' },
  { id: 'e2e-sub', ville: 'Souscent', off: 0.03, prix: '1.896' },
  { id: 'e2e-sup', ville: 'Surcent', off: 0.008, prix: '1.904' },
  { id: 'e2e-mid', ville: 'Milieu', off: -0.01, prix: '2.100' },
  { id: 'e2e-top', ville: 'Sommet', off: -0.02, prix: '2.150' },
]

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = STATIONS.map((s, i) => ({
      id: s.id,
      ville: s.ville,
      adresse: `${i} rue du Test`,
      geom: { lat: lat + s.off, lon: lng },
      gazole_prix: s.prix,
    }))
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await gotoMap(page)
})

test('two stations reading the same price share the same tier', async ({ page }) => {
  // Both « 1,90 » pins are bons plans — the raw threshold inside the cent
  // must not color one green and leave the other gray
  await expect(page.locator('.pin-bubble--deal')).toHaveCount(3)
  await expect(page.locator('.pin-bubble--deal', { hasText: '1,90' })).toHaveCount(2)
  await expect(page.locator('.pin-bubble--high', { hasText: '2,15' })).toHaveCount(1)

  // And both rows carry the same displayed delta: 1,90 − 1,87 = +0,03
  await page.getByRole('button', { name: /liste des stations/ }).click()
  await expect(page.getByText('bon plan · +0,03')).toHaveCount(2)
})
