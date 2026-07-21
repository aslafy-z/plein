import { test, expect, gotoMap } from './fixtures'

// The strategy scoring and autonomy math are unit-tested (selectRouteAnalysis)
// — this checks the WIRING on the deterministic Toulouse → Bordeaux demo
// corridor: the chips really swap the recommended stop, and the setup slider
// really caps the recommendation to reachable stations.

test('the strategy chips swap the recommended stop', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()
  await page.locator('input[placeholder="Destination"]').fill('Bordeaux')
  await page.getByText('Bordeaux centre').click()
  await page.getByText('Comparer les stations sur le trajet').click()
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })

  // Meilleur compromis (default) → price AND détour weighed together
  const reco = page.getByRole('button', { name: /^Fiche de/ })
  await expect(reco).toContainText("Leclerc · Valence-d'Agen")

  // Prix le + bas → the sticker-cheapest wins whatever the détour
  await page.getByText('Prix le + bas').click()
  await expect(reco).toContainText('Carrefour · Aiguillon')

  // Détour min. → the on-route motorway station wins despite its price
  await page.getByText('Détour min.').click()
  await expect(reco).toContainText('Total Relais · A62')
  await expect(page.getByText('Sur votre route · sans détour')).toBeVisible()
})

test('a low departure tank caps the autonomy and forces a reachable stop', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()

  // Réservoir au départ 10 % → 5 L / 6,5 L/100 km ≈ 77 km, limite 60 km
  await page.locator('input[type=range]').fill('10')
  await page.locator('input[placeholder="Destination"]').fill('Bordeaux')
  await page.getByText('Bordeaux centre').click()
  await page.getByText('Comparer les stations sur le trajet').click()
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })

  await expect(page.getByText('Réservoir 10 % · autonomie ≈ 77 km')).toBeVisible()
  await expect(page.getByText(/autonomie insuffisante/).first()).toBeVisible()

  // The recommendation must sit BEFORE the limit: the corridor-wide winner
  // at KM ~85 is out of reach, the first stops (KM ~34/58) are not
  await expect(page.getByRole('button', { name: /^Fiche de/ })).toContainText(
    'Intermarché · Grisolles',
  )
})
