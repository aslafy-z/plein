import { test, expect, phoneOnly, gotoMap, openZoneList, closeZoneList } from './fixtures'

// The collapsed sheet parks its body below the stage without unmounting it.
// Left focusable, Tab walks into it and the browser scrolls the stage to
// reveal the focus — the map ends up shoved off the top of the screen.
phoneOnly('a window docks the list — nothing is parked off screen')

type Page = import('@playwright/test').Page

const isInert = (page: Page) =>
  page.locator('[data-sheet-body]').evaluate((el) => (el as HTMLElement).inert)

/** Where the focus is, and how far anything around the sheet got scrolled */
const probe = (page: Page) =>
  page.evaluate(() => {
    const wrap = document.querySelector('[data-sheet-body]')
    let scrolled = 0
    for (let el = wrap?.parentElement; el; el = el.parentElement) {
      scrolled = Math.max(scrolled, el.scrollTop)
    }
    return {
      inBody: !!wrap && wrap.contains(document.activeElement),
      scrolled,
    }
  })

test('Tab never enters the collapsed sheet body nor scrolls the stage', async ({ page }) => {
  await gotoMap(page)
  await expect(page.getByTestId('zone-list')).toBeAttached()
  await expect.poll(() => isInert(page)).toBe(true)

  // Both ways round: forward the map's own stops come first, backward the
  // focus enters from the end of the document — the bottom tabs, then right
  // where the body's last rows would be
  for (const key of ['Shift+Tab', 'Tab']) {
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(key)
      expect(await probe(page), `after ${key} #${i + 1}`).toEqual({ inBody: false, scrolled: 0 })
    }
  }
})

test('the body is reachable again once the sheet is open', async ({ page }) => {
  await gotoMap(page)
  await expect(page.getByTestId('zone-list')).toBeAttached()
  await expect.poll(() => isInert(page)).toBe(true)

  await openZoneList(page)
  expect(await isInert(page)).toBe(false)
  await page.getByTestId('zone-row').first().focus()
  expect((await probe(page)).inBody).toBe(true)

  // Closing parks it again — once the glide has landed, not before
  await closeZoneList(page)
  await expect.poll(() => isInert(page)).toBe(true)
})
