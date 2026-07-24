import { test, expect, gotoMap } from './fixtures'

/**
 * Leaflet clips its vector layers to a box it only recomputes on `moveend`.
 * While the button stays down the search circle glides with the screen centre
 * and used to run into that frozen box — the zone came out sliced by an
 * invisible rectangle. The invariant: mid-drag the clip box still covers the
 * whole map viewport, so nothing visible can be cut.
 */
test('the search circle keeps its clip box while the mouse stays down', async ({ page }) => {
  await gotoMap(page)
  const stage = await page.locator('.leaflet-container').boundingBox()
  expect(stage).not.toBeNull()
  const cx = stage!.x + stage!.width / 2
  const cy = stage!.y + stage!.height / 2

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx - 200, cy - 160, { steps: 12 })
  const held = await page.evaluate(() => {
    const svg = document.querySelector('.leaflet-overlay-pane svg')
    const stage = document.querySelector('.leaflet-container')
    if (!svg || !stage) return null
    const clip = svg.getBoundingClientRect()
    const view = stage.getBoundingClientRect()
    return {
      left: clip.left <= view.left,
      top: clip.top <= view.top,
      right: clip.right >= view.right,
      bottom: clip.bottom >= view.bottom,
    }
  })
  await page.mouse.up()

  expect(held).toEqual({ left: true, top: true, right: true, bottom: true })
})
