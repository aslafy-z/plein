import { test, expect, gotoMap, openZoneList, seedStationsCache } from './fixtures'

// Slight pans must not refetch stations: every fetch covers MAX_RADIUS_KM
// (25 km) around its center, so while the displayed zone stays inside a
// freshly fetched area the store re-uses the cached stations and skips the
// network entirely — the data equivalent of the prefetched basemap tiles.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

test('a slight pan re-uses the fetched area instead of refetching', async ({ page }) => {
  let gouvCalls = 0

  // Deterministic gouv flux: echo three stations around the queried center.
  await page.route('**/proxy/fra/**', async (route) => {
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
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )

  await gotoMap(page)
  await page.waitForTimeout(1000) // let the initial load fully settle
  const initialCalls = gouvCalls
  expect(initialCalls).toBeGreaterThan(0)

  // Pan until the app leaves « near you » mode (= the pan triggered a station
  // reload via setSearchArea), like map.spec.ts does. The drag is deliberately
  // short: the auto-fit frames the 5 km circle around z11, where a screen-wide
  // drag crosses ~27 km and would land outside the fetched area — a legitimate
  // refetch, and nothing left to prove. ~130 px ≈ 10 km keeps the moved zone
  // (drift + radius) inside the fresh 25 km area, so zero new requests.
  const zone = page
    .getByText('La moins chère dans cette zone')
    .or(page.getByText('Aucune station ne correspond'))
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  for (let i = 0; i < 6 && !(await zone.first().isVisible()); i++) {
    await page.mouse.move(cx + 50, cy + 40)
    await page.mouse.down()
    await page.mouse.move(cx - 50, cy - 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(700) // moveend debounce (350 ms) + reload window
  }
  await expect(zone.first()).toBeVisible()

  await page.waitForTimeout(1200) // any would-be refetch fires in this window
  expect(gouvCalls, 'zone inside the fresh 25 km area → no refetch').toBe(initialCalls)
})

// Reloading must not depend on the source being reachable: the fetched area
// lives in IndexedDB, so a cold boot paints it before anything is requested.
// The unit suite covers the cache's own rules against a substitute store; what
// only a browser can prove is that the records really survive a reload.
test('a reload paints the fetched area even with the source cut', async ({ page }) => {
  let sourceUp = true
  await page.route('**/proxy/fra/**', async (route) => {
    if (!sourceUp) return route.abort()
    await route.fulfill({
      json: {
        total_count: 1,
        results: [
          {
            id: 'e2e-cached',
            ville: 'Cacheville',
            adresse: '1 rue Persistante',
            geom: { lat: 43.6047, lon: 1.4442 },
            gazole_prix: '1.499',
          },
        ],
      },
    })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )

  await gotoMap(page)
  await openZoneList(page)
  await expect(page.getByText('Cacheville').first()).toBeVisible()
  // The cache is written on idle — leave the flush a window before reloading
  await page.waitForTimeout(1500)

  sourceUp = false
  await page.reload()

  // The zone card is what says the stations are on screen — the sheet handle
  // only exists once they are, so waiting on it first is what keeps
  // `openZoneList` from deciding against a page that has not painted yet.
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await openZoneList(page)
  await expect(page.getByText('Cacheville').first()).toBeVisible()
})

// Past the revalidation window the chip must stop saying « il y a N j » and
// name the day the prices were read — an age nothing but a seeded area can
// produce, since the app can only ever write `Date.now()`.
test('an area older than the revalidation window is dated, not merely aged', async ({ page }) => {
  await page.route('**/proxy/fra/**', (route) => route.abort())
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )

  const twoDaysAgo = 2 * 24 * 3_600_000
  await seedStationsCache(page, [
    {
      source: 'fra',
      center: { lat: 43.6047, lng: 1.4442 },
      fetchRadiusKm: 25,
      ageMs: twoDaysAgo,
      stations: [
        {
          id: 'fra-seeded',
          name: 'Station · Vieilleville',
          init: 'SV',
          lat: 43.6047,
          lng: 1.4442,
          address: '2 rue Ancienne',
          city: 'Vieilleville',
          prices: { diesel: { value: 1.599 } },
          tags: [],
          services: [],
          highway: false,
        },
      ],
    },
  ])
  await page.reload()

  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  // « Prix du 28 juil. », not « il y a 2 j »
  await expect(page.getByRole('button', { name: 'Recharger les prix' })).toContainText(/Prix du/)
  await openZoneList(page)
  await expect(page.getByText('Vieilleville').first()).toBeVisible()
})
