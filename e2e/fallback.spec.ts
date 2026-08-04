import { test, expect, gotoMap } from './fixtures'

// When the real source is down (every gouv request aborted here — no network
// luck involved, unlike sources.spec.ts), the app must own up and keep the
// map honest: an explicit notice, a retry, and never a silent switch to the
// demo dataset. Offline, previously loaded stations stay on screen.

test.use({ seed: { sourceId: 'fr', onboarded: true } })

const SOURCE_DOWN = 'Live source unavailable — the prices shown may be out of date.'
const OFFLINE = 'Offline — the prices shown may be out of date.'

// Deterministic gouv flux: echo one station near the queried center.
function fulfillStations(route: import('@playwright/test').Route) {
  const where = new URL(route.request().url()).searchParams.get('where') ?? ''
  const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
  const lng = m ? parseFloat(m[1]) : 1.44
  const lat = m ? parseFloat(m[2]) : 43.6
  return route.fulfill({
    json: {
      total_count: 1,
      results: [
        {
          id: 'e2e-1',
          ville: 'Testville',
          adresse: '1 rue du Test',
          geom: { lat: lat + 0.01, lon: lng },
          gazole_prix: '1.80',
        },
      ],
    },
  })
}

/** Drag the map by (dx, dy) css pixels, starting clear of the desktop panel */
async function drag(page: import('@playwright/test').Page, dx: number, dy: number) {
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  const sx = box.x + box.width * (dx > 0 ? 0.7 : 0.35)
  const sy = box.y + box.height * (dy > 0 ? 0.55 : 0.35)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx - dx, sy - dy, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
})

test('a dead gouv source shows the source-down state, never demo data', async ({ page }) => {
  await page.route('**/proxy/fr/**', (route) => route.abort())
  await page.goto('/')

  // The banner owns up and offers a retry
  await expect(page.getByText(SOURCE_DOWN)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Retry' }).first()).toBeVisible()

  // The zone card explains the empty zone without blaming the filters
  await expect(page.getByText('The stations for this area could not be loaded.')).toBeVisible()
  await expect(page.getByText('No station matches')).toHaveCount(0)

  // The demo dataset stays out of it
  await expect(page.getByText('Station U · Croix-Blanche')).toHaveCount(0)
  await expect(page.getByText('1.67 €')).toHaveCount(0)

  // « Settings » repeats the notice but still does not offer the demo
  // dataset — its row only exists while demo is the active source
  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByText(/unavailable right now/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Demo data/ })).toHaveCount(0)
})

test('retry loads the real source once it answers again', async ({ page }) => {
  let dead = true
  await page.route('**/proxy/fr/**', (route) => (dead ? route.abort() : fulfillStations(route)))
  await page.goto('/')
  await expect(page.getByText(SOURCE_DOWN)).toBeVisible({ timeout: 30_000 })

  dead = false
  await page.getByRole('button', { name: 'Retry' }).first().click()

  await expect(page.getByText(/The cheapest|The best choice/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Testville/).first()).toBeVisible()
  await expect(page.getByText(SOURCE_DOWN)).toHaveCount(0)
})

test('going offline keeps the loaded stations and never resets the card', async ({ page }) => {
  await page.route('**/proxy/fr/**', fulfillStations)
  await gotoMap(page)

  // Cut the network: interception now aborts, and the browser knows it is
  // offline (which labels the notice and gates the auto-retry).
  await page.unroute('**/proxy/fr/**')
  await page.route('**/proxy/fr/**', (route) => route.abort())
  await page.context().setOffline(true)

  // Drag beyond the fetched 25 km area until an attempt fails
  const banner = page.getByText(OFFLINE)
  for (let i = 0; i < 12 && !(await banner.isVisible()); i++) {
    await drag(page, 240, 140)
    await page.waitForTimeout(500)
  }
  await expect(banner).toBeVisible()

  // Nothing reset: no loading state took over, no demo station appeared
  await expect(page.getByText(/Searching for stations|Looking for stations/)).toHaveCount(0)
  await expect(page.getByText('Station U · Croix-Blanche')).toHaveCount(0)

  // Returning to the original zone re-paints it from cache — no network, no
  // flicker (recentre is exact where a reverse drag would fight inertia)
  await page.getByRole('button', { name: 'Recentre on my position' }).click()
  await expect(page.getByText(/Testville/).first()).toBeVisible()
  await expect(banner).toBeVisible()

  // Connectivity back → the store revalidates on its own, the notice clears
  await page.unroute('**/proxy/fr/**')
  await page.route('**/proxy/fr/**', fulfillStations)
  await page.context().setOffline(false)
  await expect(page.getByText(OFFLINE)).toHaveCount(0, { timeout: 20_000 })
})
