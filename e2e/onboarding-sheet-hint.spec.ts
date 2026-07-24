import { test, expect } from './fixtures'

test.describe('a newcomer', () => {
  test.use({ seed: { sourceId: 'demo' } })

  test('the sheet bounces once after onboarding, then never again', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Continuer sans localisation').click()

    // The zone holds several stations → the collapsed sheet shows it pulls up
    await expect(page.locator('.sheet-hint')).toBeVisible({ timeout: 15_000 })
    // …and settles back on its own
    await expect(page.locator('.sheet-hint')).toHaveCount(0, { timeout: 5_000 })

    // The hint is spent: a reload lands on the same map without it
    await page.reload()
    await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1000) // past the hint's delay + duration
    await expect(page.locator('.sheet-hint')).toHaveCount(0)
  })
})

test.describe('a returning user', () => {
  // Onboarded before the hint existed — nothing to teach, no bounce
  test.use({ seed: { sourceId: 'demo', onboarded: true } })

  test('never sees the hint', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(1000)
    await expect(page.locator('.sheet-hint')).toHaveCount(0)
  })
})
