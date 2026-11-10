import { test, expect, gotoMap, closeZoneList, phoneOnly } from './fixtures'

// With « reduce motion » asked for, the sheets still open, close and reach
// their snap points — they just stop travelling there. The slide durations
// are CSS tokens zeroed by the media query, so no transitionend ever fires:
// these tests pin that nothing was waiting on one.
test.describe('reduced motion', () => {
  phoneOnly('the sheets only exist in the phone arrangement')

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoMap(page)
  })

  test('the bottom sheet lands on its snap points without a slide', async ({ page }) => {
    const handle = page.getByRole('button', { name: /list of stations/ })
    // The collapsed sheet still resizes as the card lands — wait it out
    let before = Number.NaN
    await expect(async () => {
      const y = (await handle.boundingBox())?.y ?? 0
      const settled = y === before
      before = y
      expect(settled, 'the collapsed sheet must settle first').toBe(true)
    }).toPass()

    await handle.click()
    await expect(handle).toHaveAttribute('aria-expanded', 'true')

    // The sheet root is the ancestor carrying the transform transition: its
    // duration resolves to nothing, and no transform transition is in flight
    const motion = await handle.evaluate((el) => {
      let root: HTMLElement | null = el as HTMLElement
      while (root && !root.style.transition.includes('transform')) root = root.parentElement
      if (!root) return null
      const sheet = root
      return {
        durations: getComputedStyle(sheet).transitionDuration,
        sliding: document
          .getAnimations()
          .filter(
            (a) =>
              a instanceof CSSTransition &&
              a.transitionProperty === 'transform' &&
              (a.effect as KeyframeEffect | null)?.target === sheet,
          ).length,
      }
    })
    expect(motion, 'the sheet root must be found above its handle').not.toBeNull()
    expect(motion!.durations).toBe('0s')
    expect(motion!.sliding).toBe(0)

    // Expanded snap point reached, and held
    let last = Number.NaN
    await expect(async () => {
      const y = (await handle.boundingBox())?.y ?? 0
      const settled = y === last && y < before - 100
      last = y
      expect(settled, 'the sheet must sit at its expanded snap point').toBe(true)
    }).toPass()

    // …and back down to the collapsed one
    await closeZoneList(page)
    await expect(async () => {
      const y = (await handle.boundingBox())?.y ?? 0
      expect(Math.abs(y - before), 'the sheet must return to its collapsed snap point').toBeLessThan(2)
    }).toPass()
  })

  test('a filter sheet dragged past halfway still closes', async ({ page }) => {
    await page.getByText('Filters · 6').click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await expect(sheet).toBeVisible()
    const height = (await sheet.boundingBox())!.height

    // A paced pull that parks before releasing, so the release votes on
    // position alone (same gesture as filters.spec.ts)
    const box = (await sheet.getByRole('button', { name: 'Close', exact: true }).boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const dy = height * 0.7
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x, y + (dy * i) / 12)
    }
    await page.waitForTimeout(250)
    await page.mouse.up()

    // The dismissal slide has no transitionend to wait for: the sheet
    // unmounts at once and hands back the map
    await expect(sheet).toBeHidden()
    await expect(page.getByText('Filters · 6')).toBeVisible()
  })
})
