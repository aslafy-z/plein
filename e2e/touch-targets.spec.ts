import {
  test,
  expect,
  gotoMap,
  openZoneList,
  openRouteSheet,
  pickRoutePlace,
  phoneOnly,
} from './fixtures'

// Icon-only controls sitting next to other tappable or draggable surfaces (the
// sheet handle, the station row, « Edit ») must offer a finger a full target,
// whatever the size of the glyph they draw. The boxes are measured on a phone,
// where a finger is the only pointer.
phoneOnly('touch targets are a phone concern')

// lastFix: the trip departs from « My position », which needs a known fix
test.use({ seed: { sourceId: 'demo', onboarded: true, lastFix: { lat: 43.6047, lng: 1.4442 } } })

const MIN_TARGET = 40

async function expectTouchTarget(control: import('@playwright/test').Locator) {
  await expect(control).toBeVisible()
  const box = await control.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(MIN_TARGET)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET)
}

test('the zone card favorite star and deselect control are full touch targets', async ({
  page,
}) => {
  await gotoMap(page)
  const star = page.getByRole('button', { name: /^Add .+ to favorites$/ }).first()
  await expectTouchTarget(star)
  // The enlarged box still toggles the favorite, not the sheet handle above it
  await star.click()
  await expect(
    page.getByRole('button', { name: /^Remove .+ from favorites$/ }).first(),
  ).toBeVisible()

  await openZoneList(page)
  await page.locator('button[aria-label^="Show "][aria-label$="on the map"]').nth(1).click()
  await expect(page.getByText('Selected station')).toBeVisible()
  const deselect = page.getByRole('button', { name: 'Deselect the station' })
  await expectTouchTarget(deselect)
  await deselect.click()
  await expect(page.getByText(/The cheapest/).first()).toBeVisible()
})

test('the route share control is a full touch target', async ({ page }) => {
  test.slow() // a route compute
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({ timeout: 30_000 })
  await openRouteSheet(page)
  await expectTouchTarget(page.getByRole('button', { name: 'Share the trip' }))
})
