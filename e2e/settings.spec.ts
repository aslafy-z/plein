import { test, expect, gotoMap } from './fixtures'

test('settings expose fuel, vehicle, consumption and data source', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Settings', { exact: true }).click()

  await expect(page.getByText('Default fuel')).toBeVisible()
  await expect(page.getByText('Motorcycle', { exact: true })).toBeVisible()
  await expect(page.getByText('Average consumption')).toBeVisible()
  await expect(page.getByText('prix-carburants.gouv.fr').first()).toBeVisible()
  await expect(page.getByText('geoportalgasolineras.es').first()).toBeVisible()
  await expect(page.getByText('tankerkoenig.de').first()).toBeVisible()
  await expect(page.getByText('Made with ❤️ in Toulouse')).toBeVisible()
})

test('credits name the price source of each covered country', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Settings', { exact: true }).click()

  await expect(page.getByText('France prices:')).toBeVisible()
  await expect(page.getByText('Spain prices:')).toBeVisible()
  await expect(page.getByText('Andorra prices:')).toBeVisible()
  await expect(page.getByText('Portugal prices:')).toBeVisible()
  await expect(page.getByRole('link', { name: 'sig.govern.ad' })).toHaveAttribute(
    'href',
    'https://sig.govern.ad/IPE/PreusCarburants',
  )
})

test('tank size setting shows the chosen value', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Settings', { exact: true }).click()

  await page.locator('input[type=range]').first().fill('80')
  await expect(page.getByText('80 L', { exact: true })).toBeVisible()
})

test('tabs are routed: refresh keeps the screen, browser back navigates', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByText('Default fuel')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Default fuel')).toBeVisible()
  expect(await page.evaluate(() => location.pathname)).toBe('/settings')

  await page.getByText('Favorites', { exact: true }).click()
  await expect(page.getByText("No favorites yet")).toBeVisible()

  await page.goBack()
  await expect(page.getByText('Default fuel')).toBeVisible()
})
