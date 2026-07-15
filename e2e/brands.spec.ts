import { test, expect, gotoMap } from './fixtures'

// The gouv flux has no station names: brands come from OpenStreetMap via
// Overpass. Public Overpass instances fail routinely (the primary was seen
// returning Apache 406s in production), and a failed fetch used to render a
// whole zone as generic « Station · Ville ». The provider now walks a list of
// mirrors — a dead primary must not cost the labels.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

test('brand labels survive a dead primary Overpass mirror', async ({ page }) => {
  // Deterministic gouv flux: one station at the queried center.
  await page.route('**/proxy/gouv/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    await route.fulfill({
      json: {
        total_count: 1,
        results: [
          {
            id: 'e2e-brand-1',
            ville: 'Testville',
            adresse: '1 rue du Test',
            geom: { lat, lon: lng },
            gazole_prix: '1.80',
            e10_prix: '1.70',
          },
        ],
      },
    })
  })

  // Primary mirror is down — the exact failure observed in production.
  await page.route('**/proxy/overpass/**', (route) =>
    route.fulfill({ status: 406, contentType: 'text/html', body: 'Not Acceptable' }),
  )
  // Fallback mirror knows the brand ~30 m from the station.
  await page.route('**/proxy/overpass-mailru/**', async (route) => {
    const data = new URL(route.request().url()).searchParams.get('data') ?? ''
    const m = /around:\d+,([-\d.]+),([-\d.]+)/.exec(data)
    const lat = m ? parseFloat(m[1]) : 43.6
    const lng = m ? parseFloat(m[2]) : 1.44
    await route.fulfill({
      json: { elements: [{ lat: lat + 0.0003, lon: lng, tags: { brand: 'Super U' } }] },
    })
  })

  await gotoMap(page)
  await expect(page.getByText('Super U · Testville').first()).toBeVisible()
})
