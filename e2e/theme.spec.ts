import { test, expect } from './fixtures'

// Theme resolution: an explicit choice in Settings wins, the browser's
// prefers-color-scheme decides otherwise, dark is the last resort. The whole
// suite pins `colorScheme: 'dark'` in playwright.config.ts; these drive the
// two paths on purpose. The attribute IS the theme — every color is a CSS
// variable keyed on it (src/styles.css), so asserting it plus one painted
// surface covers the flip.

test('follows the browser preference while no choice is made', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Still « auto »: the browser flipping to dark flips the app live
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('an explicit choice re-colors in place and survives a reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Light', exact: true }).click()

  // No reload: the attribute flips and the shell repaints from the variables
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('.app-shell')).toHaveCSS('background-color', 'rgb(233, 239, 235)')

  // The choice beats the (dark) browser preference after a reload too
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  })

  // « Browser theme » drops the override — back to the browser's dark
  await page.getByRole('button', { name: 'Browser theme', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test.describe('seeded choice', () => {
  // Through the persisted blob, like any other setting — the pre-paint script
  // in index.html must pick it up on the very first load
  test.use({ seed: { sourceId: 'demo', onboarded: true, theme: 'light' } })

  test('paints light from the first load', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('.app-shell')).toHaveCSS(
      'background-color',
      'rgb(233, 239, 235)',
    )
  })
})
