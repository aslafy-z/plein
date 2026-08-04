import { test, expect } from './fixtures'

// Locale resolution: an explicit choice in Settings wins, the browser's
// language decides otherwise, French (the source locale) is the last resort.
// Every other spec pins `locale: 'en'` through the fixture; these drive the
// two paths on purpose, so the browser language is set per block rather than
// inherited.

test('an explicit choice drives the whole UI and survives a reload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Español', exact: true }).click()

  // No reload: the tree re-renders in place, tabs and headings included
  await expect(page.getByRole('button', { name: 'Mapa', exact: true })).toBeVisible()
  await expect(page.getByText('Ajustes', { exact: true }).first()).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')

  await page.reload()
  await expect(page.getByText('Ajustes', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Mapa', exact: true })).toBeVisible()
})

test('the chosen language reaches the map chips and the sheet card', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Français', exact: true }).click()
  await page.getByRole('button', { name: 'Carte', exact: true }).click()

  // In French the diesel chip reads « Gazole » — the fuel label is catalog copy
  await expect(page.getByText('Gazole ↻')).toBeVisible()
  await expect(page.getByText(/^Filtres · \d+$/)).toBeVisible()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
})

test('Catalan — the language of Andorra — reaches every screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Català', exact: true }).click()

  await expect(page.getByText('Configuració', { exact: true }).first()).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ca')

  await page.getByRole('button', { name: 'Mapa', exact: true }).click()
  await expect(page.getByText('La més barata a prop teu')).toBeVisible()
})

test.describe('browser detection', () => {
  // No explicit choice in the blob, and a browser that asks for Spanish
  test.use({ locale: 'es-ES', seed: { sourceId: 'demo', onboarded: true, locale: null } })

  test('with nothing chosen the app follows the browser language', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('La más barata cerca de ti')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  })

  test('« Browser language » gives detection back after an override', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('La más barata cerca de ti')).toBeVisible({ timeout: 15_000 })

    // The buttons below are clicked in the language the UI is showing at that
    // moment: Spanish first, then French once the override lands.
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click()
    await page.getByRole('button', { name: 'Français', exact: true }).click()
    await expect(page.getByText('Réglages', { exact: true }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Langue du navigateur', exact: true }).click()
    await expect(page.getByText('Ajustes', { exact: true }).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')

    // …and the override is really gone, not merely overwritten
    await page.reload()
    await expect(page.getByText('Ajustes', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  })
})
