// The map auto-fit frames the SEARCH CIRCLE, so the zoom level always reads
// the radius the user asked for — not the density of the stations inside it.
import { test, expect, gotoMap, mapZoom } from './fixtures'

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

/**
 * Move the radius slider in the filters sheet and apply. Returns the level the
 * map sits on as the new radius lands — the anchor `settled` needs to tell the
 * fit that follows from the view it starts from.
 */
async function setRadius(page: import('@playwright/test').Page, km: string) {
  await page.getByText(/^Filters · \d+$/).click()
  const slider = page.locator('input[type=range]')
  // The anchor MUST be read before the slider moves: the radius commits on a
  // short debounce after the input event (FiltersSheet), and the button below
  // flushes it as it closes the sheet. Reading it after would already be the
  // post-fit level, and the fit could then never be seen to land. The sheet
  // standing open has not moved the map: the map's inset follows the
  // COLLAPSED sheet height.
  const before = await mapZoom(page)
  await slider.fill(km)
  await expect(slider).toHaveValue(km)
  await page.getByText(/^Show \d+ stations?$/).click()
  await expect(page.getByText(`< ${km} km`)).toBeVisible()
  return before
}

/**
 * Level the fit lands on, `previous` being the one the map showed before the
 * change. It must have MOVED off `previous` and then hold still: the pre-fit
 * level is stable by definition, so stability alone would happily settle on
 * the view the fit has not left yet.
 */
async function settled(page: import('@playwright/test').Page, previous: number) {
  let last = Number.NaN
  let level = Number.NaN
  // The reading is recorded BEFORE the assertion: throwing first would leave
  // `last` at NaN for every retry, and no two readings could ever match.
  await expect(async () => {
    const z = await mapZoom(page)
    const settledOn = z === last && z !== previous
    level = z
    last = z
    expect(settledOn).toBe(true)
  }).toPass()
  return level
}

test('the zoom follows the search radius', async ({ page }) => {
  const wide = await settled(page, await setRadius(page, '25'))
  const tight = await settled(page, await setRadius(page, '3'))

  // 25 km → 3 km is a bit over 3 halvings of the framed box; the fit is
  // capped at z15 so assert the direction and a sane order of magnitude
  expect(tight).toBeGreaterThan(wide)
  expect(tight - wide).toBeGreaterThanOrEqual(2)
})

test('searching a place lands on the radius, whatever the stations do there', async ({ page }) => {
  const home = await settled(page, await setRadius(page, '10'))

  await page.getByText('Search a place or a route…').click()
  await page.locator('input[placeholder="Town, address…"]').fill('Marseille')
  await page.getByText(/see the stations here/).first().click()
  await expect(page.getByText('Marseille').first()).toBeVisible({ timeout: 15_000 })

  // Same radius, same viewport → the searched place is framed as wide as home
  // was, however few (or many) stations sit around it. That is the whole point:
  // fitting the STATIONS used to zoom several levels past the radius whenever
  // they clustered near the centre.
  //
  // Within one level, not exactly equal. `fitBounds` snaps to a whole level,
  // and a radius spans slightly more longitude the further north you are
  // (radiusBounds divides by cos(lat)) — so Toulouse and Marseille ask for
  // fractional zooms a hair apart, and a pair that straddles an integer
  // boundary floors either side of it. At 800 px wide they do; at 412 they
  // don't, which is the only reason this ever looked exact.
  await expect(async () => {
    expect(Math.abs((await mapZoom(page)) - home)).toBeLessThanOrEqual(1)
  }).toPass()
})
