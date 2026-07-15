import { test, expect, gotoMap } from './fixtures'

// Slight pans must not refetch stations: every fetch covers MAX_RADIUS_KM
// (25 km) around its center, so while the displayed zone stays inside a
// freshly fetched area the store re-uses the cached stations and skips the
// network entirely — the data equivalent of the prefetched basemap tiles.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

test('a slight pan re-uses the fetched area instead of refetching', async ({ page }) => {
  let gouvCalls = 0

  // Deterministic gouv flux: echo three stations around the queried center.
  await page.route('**/proxy/gouv/**', async (route) => {
    gouvCalls++
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const station = (i: number, dLat: number, dLng: number) => ({
      id: `e2e-${i}`,
      ville: 'Testville',
      adresse: `${i} rue du Test`,
      geom: { lat: lat + dLat, lon: lng + dLng },
      gazole_prix: `1.8${i}`,
      e10_prix: `1.7${i}`,
    })
    await route.fulfill({
      json: {
        total_count: 3,
        results: [station(1, 0.012, 0.002), station(2, -0.01, 0.011), station(3, 0.002, -0.013)],
      },
    })
  })
  // Brand enrichment is irrelevant here — keep it deterministic and instant
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )

  await gotoMap(page)
  await page.waitForTimeout(1000) // let the initial load fully settle
  const initialCalls = gouvCalls
  expect(initialCalls).toBeGreaterThan(0)

  // Pan until the app leaves « near you » mode (= the pan triggered a station
  // reload via setSearchArea), like map.spec.ts does. The total drift stays a
  // few km — far inside the fresh 25 km fetched area, so zero new requests.
  const zone = page
    .getByText('La moins chère dans cette zone')
    .or(page.getByText('Aucune station ne correspond'))
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  for (let i = 0; i < 6 && !(await zone.first().isVisible()); i++) {
    await page.mouse.move(cx + 130, cy + 100)
    await page.mouse.down()
    await page.mouse.move(cx - 140, cy - 110, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(700) // moveend debounce (350 ms) + reload window
  }
  await expect(zone.first()).toBeVisible()

  await page.waitForTimeout(1200) // any would-be refetch fires in this window
  expect(gouvCalls, 'zone inside the fresh 25 km area → no refetch').toBe(initialCalls)
})
