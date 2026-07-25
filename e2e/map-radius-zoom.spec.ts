// The map auto-fit frames the SEARCH CIRCLE, so the zoom level always reads
// the radius the user asked for — not the density of the stations inside it.
import { test, expect, gotoMap, tileZoom } from './fixtures'

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

/**
 * Move the radius slider in the filters sheet and apply. Returns the level the
 * map sits on as the new radius lands — the anchor `settled` needs to tell the
 * fit that follows from the view it starts from.
 */
async function setRadius(page: import('@playwright/test').Page, km: string) {
  await page.getByText(/^Filtres · \d+$/).click()
  const slider = page.locator('input[type=range]')
  await slider.fill(km)
  await expect(slider).toHaveValue(km)
  // Read the level here, not before opening the sheet: the map's inset follows
  // the COLLAPSED sheet height, so the sheet standing open has not moved the
  // view — and by now any earlier fit has long landed.
  const before = await tileZoom(page)
  await page.getByText(/^Voir \d+ stations?$/).click()
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
    const z = await tileZoom(page)
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

  await page.getByText('Chercher un lieu ou un trajet…').click()
  await page.locator('input[placeholder="Ville, adresse…"]').fill('Marseille')
  await page.getByText(/voir les stations ici/).first().click()
  await expect(page.getByText('Marseille').first()).toBeVisible({ timeout: 15_000 })

  // Same radius, same viewport → the searched place is framed exactly as
  // wide as home was, however few (or many) stations sit around it
  await expect(async () => {
    expect(await tileZoom(page)).toBe(home)
  }).toPass()
})
