import { test, expect, gotoMap } from './fixtures'

// The zone-count math is unit-tested (selectVisible) — these tests check the
// sheet's WIRING: counts land on the buttons and the map chip, and the
// « fuel not sold here » empty state guides the user out. The demo zone
// around Toulouse Capitole holds exactly 6 stations within the default 5 km.

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

test('service filters narrow the live count and Réinitialiser restores it', async ({ page }) => {
  await page.getByText('Filtres · 6').click()

  // 4 of the 6 zone stations are 24/24 (not Carrefour Market, not Garage Morel)
  await page.getByRole('button', { name: 'Ouvert 24/24', exact: true }).click()
  await expect(page.getByText('Voir 4 stations')).toBeVisible()
  await page.getByText('Voir 4 stations').click()
  await expect(page.getByText('Filtres · 4')).toBeVisible()

  // The list only keeps the matching stations
  await page.getByRole('button', { name: /liste des stations/ }).click()
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible()
  await expect(page.getByText('Carrefour Market')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Fermer la liste' })
    .click({ position: { x: 40, y: 30 } })

  // Réinitialiser clears the selection with the rest of the filters
  await page.getByText('Filtres · 4').click()
  await page.getByText('Réinitialiser').click()
  await expect(page.getByText('Voir 6 stations')).toBeVisible()
})

test('a fuel nobody sells in the zone names itself and offers what IS sold', async ({ page }) => {
  // No station within 5 km sells GPLc (the demo GPLc pumps sit farther out)
  await page.getByText('Filtres · 6').click()
  await page.getByRole('button', { name: 'GPLc', exact: true }).click()
  await expect(page.getByText('Voir 0 stations')).toBeVisible()
  await page.getByText('Voir 0 stations').click()

  // The empty state must name the culprit, not look broken…
  await expect(page.getByText('Aucune station ne vend du GPLc dans cette zone.')).toBeVisible()
  await expect(page.getByText('Vendus ici :')).toBeVisible()

  // …and its chips switch straight to a fuel the zone actually sells
  await page.getByRole('button', { name: 'Gazole', exact: true }).click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
  await expect(page.getByText('Gazole ↻')).toBeVisible()
})
