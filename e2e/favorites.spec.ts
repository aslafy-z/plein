import { test, expect, gotoMap } from './fixtures'

test('starring a station pins it to Favoris, which jumps back to the map', async ({ page }) => {
  await gotoMap(page)

  // Empty state until something is starred
  await page.getByText('Favoris', { exact: true }).click()
  await expect(page.getByText("Aucun favori pour l'instant")).toBeVisible()

  // Star the shown station from its detail page
  await page.getByText('Carte', { exact: true }).click()
  await page.getByText(/MàJ /).first().click()
  await page.getByRole('button', { name: 'Ajouter aux favoris' }).click()
  await expect(page.getByRole('button', { name: 'Retirer des favoris' })).toBeVisible()
  await page.getByRole('button', { name: 'Retour' }).click()

  // Listed with a live price and the sort chips (Recommandé by default)
  await page.getByText('Favoris', { exact: true }).click()
  await expect(
    page.locator('button[aria-label^="Retirer "][aria-label$="des favoris"]').first(),
  ).toBeVisible()
  await expect(page.getByText('€').first()).toBeVisible()
  await expect(page.getByText('Recommandé', { exact: true })).toBeVisible()

  // A favorite row opens the map with the station selected
  await page.locator('button[aria-label^="Voir "][aria-label$="sur la carte"]').first().click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible()
})
