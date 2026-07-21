import { test, expect, gotoMap } from './fixtures'

// The vehicle profile is not cosmetic: switching to Moto applies its presets
// (SP95-E10, 15 L tank, 5,0 L/100 km) everywhere — the map chip, the prices
// compared, the savings math — and survives a reload.

test('the Moto profile applies its fuel, tank and consumption presets', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Réglages', { exact: true }).click()

  await page.getByRole('button', { name: 'Moto', exact: true }).click()
  await expect(page.getByText('15 L', { exact: true })).toBeVisible()
  await expect(page.getByText('5,0 L/100 km', { exact: true })).toBeVisible()

  // Back on the map: fuel followed the profile, prices are E10 prices
  await page.getByText('Carte', { exact: true }).click()
  await expect(page.getByText('SP95-E10 ↻')).toBeVisible()
  await expect(page.getByText('1,78 €').first()).toBeVisible()

  // The profile is persisted with the settings
  await page.reload()
  await expect(page.getByText('SP95-E10 ↻')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Réglages', { exact: true }).click()
  await expect(page.getByText('15 L', { exact: true })).toBeVisible()
})

test('changing the default fuel in Réglages retargets the whole map', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Réglages', { exact: true }).click()

  await page.getByRole('button', { name: 'E85', exact: true }).click()
  await page.getByText('Carte', { exact: true }).click()

  await expect(page.getByText('E85 ↻')).toBeVisible()
  // Cheapest E85 of the zone: Station U at 0,84 €
  await expect(page.getByText('0,84 €').first()).toBeVisible()
})
