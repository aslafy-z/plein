import { test, expect, gotoMap } from './fixtures'

test('settings expose fuel, vehicle, consumption and data source', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Réglages', { exact: true }).click()

  await expect(page.getByText('Carburant par défaut')).toBeVisible()
  await expect(page.getByText('Moto', { exact: true })).toBeVisible()
  await expect(page.getByText('Consommation moyenne')).toBeVisible()
  await expect(page.getByText('prix-carburants.gouv.fr').first()).toBeVisible()
  await expect(page.getByText('Made with ❤️ in Toulouse')).toBeVisible()
})

test('tank size setting shows the chosen value', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Réglages', { exact: true }).click()

  await page.locator('input[type=range]').first().fill('80')
  await expect(page.getByText('80 L', { exact: true })).toBeVisible()
})

test('tabs are routed: refresh keeps the screen, browser back navigates', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Réglages', { exact: true }).click()
  await expect(page.getByText('Carburant par défaut')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Carburant par défaut')).toBeVisible()
  expect(await page.evaluate(() => location.pathname)).toBe('/settings')

  await page.getByText('Favoris', { exact: true }).click()
  await expect(page.getByText("Aucun favori pour l'instant")).toBeVisible()

  await page.goBack()
  await expect(page.getByText('Carburant par défaut')).toBeVisible()
})
