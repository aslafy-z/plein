import { test, expect, gotoMap, openRouteSheet, pickRoutePlace } from './fixtures'

test('route comparison: map-first shell, tour, station detail and history', async ({ page }) => {
  await gotoMap(page)

  // ── The route shows the map from the first frame, form floating over it ──
  await page.getByText('Trajet', { exact: true }).click()
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  const cta = page.getByRole('button', { name: 'Comparer les stations sur le trajet' })
  await expect(cta).toBeVisible()

  // ── Compute a route: the default position IS Toulouse, so pick a real
  // destination through the shared search field ──
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await cta.click()

  // ── Results in the same shell: recommended stop, corridor map still up ──
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  await openRouteSheet(page)
  await expect(page.getByText(/de carburant/)).toBeVisible()

  // strategy switch
  await page.getByText('Prix le + bas').click()
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible()

  // add the recommended stop to the tour
  await page.getByRole('button', { name: 'Ajouter à la tournée' }).first().click()
  await expect(page.getByText('Lancer la tournée ›')).toBeVisible()

  // ── Station detail from the recommended stop ──
  await page.getByRole('button', { name: /Fiche de/ }).click()
  // « Services » is the fiche section both arrangements render — the desktop
  // fiche has no mini-map
  await expect(page.getByText('Services')).toBeVisible()
  await expect(page.getByText(/MàJ il y a/).first()).toBeVisible()
  // Desktop: the fiche stacks INSIDE the route panel — the reader stays in
  // the route view, corridor map up (a phone shows the fiche full screen)
  if ((await page.getByTestId('route-panel').count()) > 0) {
    await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  }
  await page.goBack()

  // ── One place history: the destination picked in the route search is
  // offered back by the MAP's search ──
  await page.getByText('Carte', { exact: true }).click()
  await page.getByLabel('Rechercher un lieu').click()
  const suggestions = page.getByTestId('search-suggestions')
  await expect(suggestions.getByText('Récents')).toBeVisible()
  await expect(suggestions.getByText('Bordeaux centre')).toBeVisible()
})
