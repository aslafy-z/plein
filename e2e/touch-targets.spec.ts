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

/** A box on paper is not a target if a neighbour paints over part of it:
    every point of a 3×3 grid across the box must hit-test to the control. */
async function expectUncovered(control: import('@playwright/test').Locator) {
  const box = await control.boundingBox()
  if (!box) throw new Error('control has no box')
  const handle = await control.elementHandle()
  for (const fx of [0.1, 0.5, 0.9]) {
    for (const fy of [0.1, 0.5, 0.9]) {
      const owned = await handle!.evaluate(
        (el, [x, y]) => {
          const hit = document.elementFromPoint(x, y)
          return hit != null && el.contains(hit)
        },
        [box.x + box.width * fx, box.y + box.height * fy],
      )
      expect(owned, `point (${fx}, ${fy}) of the box`).toBe(true)
    }
  }
}

test('the route header share and edit controls are full touch targets', async ({ page }) => {
  test.slow() // a route compute
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({ timeout: 30_000 })
  await openRouteSheet(page)
  const share = page.getByRole('button', { name: 'Share the trip' })
  const edit = page.getByRole('button', { name: 'Edit', exact: true })
  for (const control of [share, edit]) {
    await expectTouchTarget(control)
    await expectUncovered(control)
  }
  // A finger near the edge of the enlarged box still edits the trip
  const box = (await edit.boundingBox())!
  await page.touchscreen.tap(box.x + box.width - 4, box.y + box.height - 4)
  await expect(edit).toBeHidden()
  await expect(page.getByRole('button', { name: 'Compare the stations along the route' })).toBeVisible()
})
