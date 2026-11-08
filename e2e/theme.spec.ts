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

// The accent is a second attribute on the same document. Asserting the
// resolved variable (not a pixel) covers every surface that paints it, and
// the light/dark pair proves the preset composes with the theme axis.
const accentVar = (page: import('@playwright/test').Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim(),
  )

test('an accent preset re-colors in place, composes with the theme and survives a reload', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'green')
  expect(await accentVar(page)).toBe('#3ddc84')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const blue = page.getByRole('button', { name: 'Blue', exact: true })
  await blue.click()
  await expect(blue).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue')
  expect(await accentVar(page)).toBe('#5aa9ff')

  // Same preset, the light theme's own tone of it
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await accentVar(page)).toBe('#1d5fc2')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue')
  await expect(page.getByRole('button', { name: 'Blue', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Back to the brand green
  await page.getByRole('button', { name: 'Green', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'green')
  expect(await accentVar(page)).toBe('#0e7146')
})

test.describe('seeded accent', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: true, accent: 'violet' } })

  test('paints the preset from the first load', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet')
    expect(await accentVar(page)).toBe('#a98bff')
  })
})
