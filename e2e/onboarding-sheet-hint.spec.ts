import { test, expect, phoneOnly } from './fixtures'

// The bounce lives for about a second and a half, which a polling locator can
// miss entirely on a loaded machine. A MutationObserver installed before boot
// latches the class the moment it appears, so the assertion is on « did it
// ever play », not « is it playing right now ».
const watchHint = (page: import('@playwright/test').Page) =>
  page.addInitScript(() => {
    const mark = () => {
      const root = document.documentElement
      if (root && !root.dataset.sheetHintSeen && document.querySelector('.sheet-hint')) {
        root.dataset.sheetHintSeen = '1'
      }
    }
    // `document`, not `documentElement`: an init script runs before the root
    // element exists
    new MutationObserver(mark).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  })

/** Latched by the observer above — set once the bounce has played */
const played = (page: import('@playwright/test').Page) =>
  page.locator('html[data-sheet-hint-seen]')

test.describe('a newcomer', () => {
  // The bounce shows that the sheet pulls up. There is no sheet on a window —
  // the list is docked and already open, so there is nothing to teach.
  phoneOnly('the pull-up hint belongs to the phone arrangement')
  test.use({ seed: { sourceId: 'demo' } })

  test('the sheet bounces once after onboarding, then never again', async ({ page }) => {
    // Two full boots (onboarding, then the reload) in one test — well past the
    // 30 s default once the workers compete for the CPU
    test.setTimeout(60_000)
    await watchHint(page)
    await page.goto('/')
    await page.getByText('Continue without location').click()

    // The zone holds several stations → the collapsed sheet shows it pulls up
    await expect(played(page)).toHaveCount(1, { timeout: 15_000 })
    // …and settles back on its own
    await expect(page.locator('.sheet-hint')).toHaveCount(0, { timeout: 5_000 })

    // The hint is spent: a reload lands on the same map without it (the
    // observer flag is per-document, so the reload starts it back at unset)
    await page.reload()
    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(2000) // past the hint's delay + duration
    await expect(played(page)).toHaveCount(0)
  })
})

test.describe('a returning user', () => {
  // Onboarded before the hint existed — nothing to teach, no bounce
  test.use({ seed: { sourceId: 'demo', onboarded: true } })

  test('never sees the hint', async ({ page }) => {
    await watchHint(page)
    await page.goto('/')
    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(2000)
    await expect(played(page)).toHaveCount(0)
  })
})
