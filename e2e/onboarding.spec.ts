import { test, expect } from './fixtures'

test.use({ seed: { sourceId: 'demo' } })

test('onboarding leads to a live map without location', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

  await page.getByText('Continue without location').click()

  await expect(page.getByText('Search a place or a route…')).toBeVisible()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
})

test.describe('with geolocation granted', () => {
  // Geolocated in Lyon — far enough from Toulouse that the demo dataset
  // translates around the user, proving the fix actually drives the map.
  test.use({ geolocation: { latitude: 45.764, longitude: 4.8357 }, permissions: ['geolocation'] })

  test('« Get started » follows the device position to a live map', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Get started', { exact: true }).click()

    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })

    // Settings reflects the granted permission
    await page.getByText('Settings', { exact: true }).click()
    await expect(page.getByText('on — the map follows your position')).toBeVisible()
  })
})
