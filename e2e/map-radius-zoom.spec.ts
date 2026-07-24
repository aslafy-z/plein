// The map auto-fit frames the SEARCH CIRCLE, so the zoom level always reads
// the radius the user asked for — not the density of the stations inside it.
import { test, expect, gotoMap, tileZoom } from './fixtures'

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

/** Move the radius slider in the filters sheet and apply */
async function setRadius(page: import('@playwright/test').Page, km: string) {
  await page.getByText(/^Filtres · \d+$/).click()
  const slider = page.locator('input[type=range]')
  await slider.fill(km)
  await expect(slider).toHaveValue(km)
  await page.getByText(/^Voir \d+ stations?$/).click()
  await expect(page.getByText(`< ${km} km`)).toBeVisible()
}

test('the zoom follows the search radius', async ({ page }) => {
  const settled = async (previous?: number) => {
    let last = Number.NaN
    let level = Number.NaN
    // Leaflet keeps the outgoing level's tiles during the fit animation —
    // wait for two identical readings before trusting one. The reading is
    // recorded BEFORE the assertion: throwing first would leave `last` at NaN
    // for every retry, and no two readings could ever match.
    await expect(async () => {
      const z = await tileZoom(page)
      const settledOn = z === last && z !== previous
      level = z
      last = z
      expect(settledOn).toBe(true)
    }).toPass()
    return level
  }

  await setRadius(page, '25')
  const wide = await settled()

  await setRadius(page, '3')
  const tight = await settled(wide)

  // 25 km → 3 km is a bit over 3 halvings of the framed box; the fit is
  // capped at z15 so assert the direction and a sane order of magnitude
  expect(tight).toBeGreaterThan(wide)
  expect(tight - wide).toBeGreaterThanOrEqual(2)
})

test('searching a place lands on the radius, whatever the stations do there', async ({ page }) => {
  await setRadius(page, '10')
  let home = Number.NaN
  await expect(async () => {
    home = await tileZoom(page)
    expect(home).toBe(await tileZoom(page))
  }).toPass()

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
