import { test, expect, gotoMap, openZoneList } from './fixtures'

// « Données » must be able to answer "what is this app keeping, and how do I
// get rid of it". Instrumentation here has to be data rather than console
// logs — the fixture fails any test whose page logs an error — so the readout
// IS the observability, and it is worth asserting.

test.use({ seed: { sourceId: 'demo', onboarded: true } })

const openSettings = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Réglages' }).click()
  await expect(page.getByTestId('cache-stats')).toBeVisible()
}

test('Réglages reports the cached zones and clears them', async ({ page }) => {
  await gotoMap(page)
  // The area is written on idle; give the flush its window before reading back
  await page.waitForTimeout(1500)

  await openSettings(page)

  // « 1 zone enregistrée · 18 ko · la plus ancienne à l'instant »
  await expect(page.getByTestId('cache-stats')).toContainText(/zone enregistrée|zones enregistrées/)

  const clear = page.getByRole('button', { name: /Effacer les données hors ligne/ })
  await expect(clear).toBeEnabled()
  await clear.click()

  await expect(page.getByTestId('cache-stats')).toHaveText('Aucune zone enregistrée pour l\'instant')
  // Nothing left to clear, and the settings themselves survived the wipe
  await expect(clear).toBeDisabled()
  await expect(page.getByRole('button', { name: /Données de démonstration/ })).toBeVisible()

  // The map still works: the source is simply queried again. `.first()` —
  // the desktop rail also carries the brand button back to the map.
  await page.getByRole('button', { name: 'Carte' }).first().click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await openZoneList(page)
})
