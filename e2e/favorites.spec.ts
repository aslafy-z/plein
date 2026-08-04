import { test, expect, gotoMap } from './fixtures'

test('starring a station pins it to Favorites, which jumps back to the map', async ({ page }) => {
  await gotoMap(page)

  // Empty state until something is starred
  await page.getByText('Favorites', { exact: true }).click()
  await expect(page.getByText('No favorites yet')).toBeVisible()

  // Star the shown station from its detail page
  await page.getByText('Map', { exact: true }).click()
  await page.getByText(/Upd\. /).first().click()
  await page.getByRole('button', { name: 'Add to favorites' }).click()
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
  await page.getByRole('button', { name: /^(Back|Close the station page)$/ }).click()

  // Listed with a live price and the sort chips (« Recommended » by default)
  await page.getByText('Favorites', { exact: true }).click()
  await expect(
    page.locator('button[aria-label^="Remove "][aria-label$="from favorites"]').first(),
  ).toBeVisible()
  await expect(page.getByText('€').first()).toBeVisible()
  await expect(page.getByText('Recommended', { exact: true })).toBeVisible()

  // A favorite row opens the map with the station selected
  await page.locator('button[aria-label^="Show "][aria-label$="on the map"]').first().click()
  await expect(page.getByText('Selected station')).toBeVisible()
})
