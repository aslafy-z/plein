import { test, expect, desktopOnly } from './fixtures'
import type { Page } from '@playwright/test'

// #144: panning from one fetched area into the next used to wipe the first
// area's pins the moment the second landed, although its stations were still
// in memory. The map now keeps drawing the areas painted earlier this
// session, while the zone (card, list) keeps describing the area it was
// fetched with. Desktop only for the mouse drag; the rule itself is pure and
// unit-tested in src/state/stationsState.test.ts.

desktopOnly()
test.use({ seed: { sourceId: 'fr', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } } })

/** Every fetched area answers 3 stations around its own center: the first at 1.501, the next ones at 1.901 */
async function mockAreas(page: Page) {
  let fetches = 0
  await page.route('**/proxy/fr/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lat = m ? parseFloat(m[2]) : 43.6
    const lng = m ? parseFloat(m[1]) : 1.44
    const first = fetches++ === 0
    const results = [0, 1, 2].map((i) => ({
      id: `${first ? 'a' : `b${fetches}`}-${i}`,
      ville: 'Testville',
      adresse: `${i} rue du Test`,
      geom: { lat: lat + (i - 1) * 0.01, lon: lng + (i - 1) * 0.01 },
      gazole_prix: first ? '1.501' : '1.901',
    }))
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  return () => fetches
}

/** Price bubbles on the map reading `text` */
function pins(page: Page, text: string) {
  return page.locator('.leaflet-marker-pane').getByText(text, { exact: true })
}

/**
 * Drags the map by `dy` px: positive moves the view north.
 *
 * One jump from just past Leaflet's click tolerance to the end, then a pause
 * before the release. The map searches live while it is dragged (one search
 * per 250 ms tick), so a drag paced over several ticks could fetch the next
 * area from any point along the way, and an area fetched ≈ 25 km out
 * covers, and so rightly drops, some of the Toulouse pins. The jump leaves
 * the end position as the only place a fetch can start from, and the pause
 * (past Leaflet's 50 ms inertia window) keeps the map from gliding further.
 */
async function dragMap(page: Page, dy: number) {
  const box = (await page.locator('.leaflet-container').first().boundingBox())!
  const x = box.x + box.width * 0.7
  const y = box.y + box.height * 0.5 - dy / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 5)
  await page.mouse.move(x, y + dy)
  await page.waitForTimeout(100)
  await page.mouse.up()
}

test('the first area keeps its pins when the next one lands, and the zone keeps its own', async ({
  page,
}) => {
  const fetches = await mockAreas(page)
  // Zoomed out (≈ 216 m/px) so both areas fit on screen
  await page.goto('/?ll=43.6047,1.4442&z=9&f=diesel&r=5')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await expect(pins(page, '1.50').first()).toBeVisible()
  const first = await pins(page, '1.50').count()

  // ≈ 35 km north: outside the 25 km the first fetch covered, so a new area loads
  await dragMap(page, 160)
  await expect.poll(fetches, { timeout: 15_000 }).toBe(2)
  await expect(pins(page, '1.90').first()).toBeVisible({ timeout: 15_000 })

  // The Toulouse pins are still on the map…
  await expect(pins(page, '1.50')).toHaveCount(first)
  // …but the zone only describes the area it was fetched with
  const list = page.getByTestId('zone-list')
  await expect(list.getByText('1.90 €').first()).toBeVisible()
  await expect(list.getByText('1.50 €')).toHaveCount(0)
})
