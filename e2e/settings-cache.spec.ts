import { test, expect, gotoMap, openZoneList } from './fixtures'

// « Data » must be able to answer "what is this app keeping, and how do I
// get rid of it". Instrumentation here has to be data rather than console
// logs — the fixture fails any test whose page logs an error — so the readout
// IS the observability, and it is worth asserting.

test.use({ seed: { sourceId: 'demo', onboarded: true } })

const openSettings = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('cache-stats')).toBeVisible()
}

test('Settings reports the cached zones and clears them', async ({ page }) => {
  await gotoMap(page)
  // The area is written on idle; give the flush its window before reading back
  await page.waitForTimeout(1500)

  await openSettings(page)

  // « 1 area stored · 18 kB · oldest just now »
  await expect(page.getByTestId('cache-stats')).toContainText(/area stored|areas stored/)

  const clear = page.getByRole('button', { name: /Clear offline data/ })
  await expect(clear).toBeEnabled()
  await clear.click()

  await expect(page.getByTestId('cache-stats')).toHaveText('No area stored yet')
  // Nothing left to clear, and the settings themselves survived the wipe
  await expect(clear).toBeDisabled()
  await expect(page.getByRole('button', { name: /Demo data/ })).toBeVisible()

  // The map still works: the source is simply queried again. `.first()` —
  // the desktop rail also carries the brand button back to the map.
  await page.getByRole('button', { name: 'Map' }).first().click()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await openZoneList(page)
})
