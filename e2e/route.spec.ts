import { test, expect, gotoMap } from './fixtures'

// A 20 % departure tank forces a plan on the Toulouse → Bordeaux demo
// corridor, so the whole flow — plan card, tour, fiche, history — has a
// recommended stop to hang off.
test.use({ seed: { sourceId: 'demo', onboarded: true, startTankPct: 20 } })

test('route comparison: ribbon, tour, station detail and history', async ({ page }) => {
  await gotoMap(page)

  // ── Setup screen ──
  await page.getByText('Trajet', { exact: true }).click()
  await expect(page.getByText('Comparez les prix le long de votre trajet')).toBeVisible()
  await expect(page.getByText('Suggestions')).toBeVisible()
  await expect(page.getByText('Toulouse', { exact: true })).toBeVisible()
  await expect(page.getByText('Éviter les péages')).toBeVisible()

  // ── Compute a route: the default position IS Toulouse, so type a real
  // destination instead of tapping the (degenerate) Toulouse suggestion ──
  await page.locator('input[placeholder="Destination"]').fill('Bordeaux')
  await page.getByText('Bordeaux centre').click()
  await page.getByText('Comparer les stations sur le trajet').click()

  // ── Ribbon: planned stop, corridor map, purchase totals ──
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  await expect(page.getByText(/à acheter/).first()).toBeVisible()

  // strategy switch → the plan recomputes (same single fill here)
  await page.getByText('Prix le + bas').click()
  await expect(page.getByText('Arrêt conseillé')).toBeVisible()

  // add the first planned stop to the tour
  await page.getByRole('button', { name: 'Ajouter à la tournée' }).first().click()
  await expect(page.getByText('Lancer la tournée ›')).toBeVisible()

  // ── Station detail from the planned stop ──
  await page.getByRole('button', { name: /Fiche de/ }).first().click()
  // « Services » is the fiche section both arrangements render — the desktop
  // fiche has no mini-map
  await expect(page.getByText('Services')).toBeVisible()
  await expect(page.getByText(/MàJ il y a/).first()).toBeVisible()
  await page.goBack()

  // ── The trip lands in the real history ──
  await page.getByText('Modifier').click()
  await expect(page.getByText('Récents', { exact: true })).toBeVisible()
  await expect(page.getByText(/fait le/).first()).toBeVisible()
})
