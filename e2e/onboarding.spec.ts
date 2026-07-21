import { test, expect } from './fixtures'

test.use({ seed: { sourceId: 'demo' } })

test('onboarding leads to a live map without location', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()

  await page.getByText('Continuer sans localisation').click()

  await expect(page.getByText('Chercher un lieu ou un trajet…')).toBeVisible()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
})

test.describe('with geolocation granted', () => {
  // Geolocated in Lyon — far enough from Toulouse that the demo dataset
  // translates around the user, proving the fix actually drives the map.
  test.use({ geolocation: { latitude: 45.764, longitude: 4.8357 }, permissions: ['geolocation'] })

  test('« Commencer » follows the device position to a live map', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Commencer', { exact: true }).click()

    await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })

    // Réglages reflects the granted permission
    await page.getByText('Réglages', { exact: true }).click()
    await expect(page.getByText('activée — la carte suit votre position')).toBeVisible()
  })
})
