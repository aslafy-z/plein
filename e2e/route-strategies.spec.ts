import { test, expect, gotoMap, closeRouteSheet, openRouteSheet, pickRoutePlace } from './fixtures'

// The strategy scoring and autonomy math are unit-tested (selectRouteAnalysis)
// — this checks the WIRING on the deterministic Toulouse → Bordeaux demo
// corridor: the chips really swap the recommended stop, and the setup slider
// really caps the recommendation to reachable stations.

test('the strategy chips swap the recommended stop', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()
  // Picking the destination submits the trip on its own — no CTA tap
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })
  await openRouteSheet(page)

  // Meilleur compromis (default) → price AND détour weighed together
  const reco = page.getByRole('button', { name: /^Fiche de/ })
  await expect(reco).toContainText("Leclerc · Valence-d'Agen")

  // Prix le + bas → the sticker-cheapest wins whatever the détour
  await page.getByText('Prix le + bas').click()
  await expect(reco).toContainText('Carrefour · Aiguillon')

  // Détour min. → the on-route motorway station wins despite its price
  await page.getByText('Détour min.').click()
  await expect(reco).toContainText('Total Relais · A62')
  // The reason shows in the timeline card AND the collapsed lead — one is enough
  await expect(page.getByText('Sur votre route · sans détour').first()).toBeVisible()
})

test('a low departure tank caps the autonomy and forces a reachable stop', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()

  // The tank slider lives in the sheet's expanded form on a phone — reveal
  // it; the CTA stays reachable either way (pinned to the bottom edge).
  await openRouteSheet(page)
  // Réservoir au départ 10 % → 5 L / 6,5 L/100 km ≈ 77 km, limite 60 km
  await page.locator('input[type=range]').fill('10')
  // The expanded sheet covers the endpoint fields on a phone — fold it back
  await closeRouteSheet(page)
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })
  await openRouteSheet(page)

  await expect(page.getByText('Réservoir 10 % · autonomie ≈ 77 km')).toBeVisible()
  await expect(page.getByText(/autonomie insuffisante/).first()).toBeVisible()

  // The recommendation must sit BEFORE the limit: the corridor-wide winner
  // at KM ~85 is out of reach, the first stops (KM ~34/58) are not
  await expect(page.getByRole('button', { name: /^Fiche de/ })).toContainText(
    'Intermarché · Grisolles',
  )
})
