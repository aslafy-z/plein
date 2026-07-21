import { test, expect, gotoMap } from './fixtures'

// The ordering math is unit-tested (sortFavoriteRows) — this checks the
// screen WIRING: live prices resolved from the loaded area, the sort chips
// actually reordering, and unpinning persisting across a reload. Seeded:
// E.Leclerc · Labège (1,65 € but ~7 km out) vs Station U (1,67 €, <1 km).

test.use({
  seed: {
    sourceId: 'demo',
    onboarded: true,
    favorites: [
      { id: 'le', name: 'E.Leclerc · Labège', init: 'EL', city: 'Labège', lat: 43.5611, lng: 1.5136 },
      { id: 'su', name: 'Station U · Croix-Blanche', init: 'SU', city: 'Toulouse', lat: 43.6101, lng: 1.4519 },
    ],
  },
})

const rows = (page: import('@playwright/test').Page) =>
  page.locator('button[aria-label^="Voir "][aria-label$="sur la carte"]')

test('live prices, sort chips, and a persistent unpin', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Favoris', { exact: true }).click()
  await expect(page.getByText('2 stations')).toBeVisible()

  // Both live prices resolved from the loaded area
  await expect(page.getByText('1,65 €')).toBeVisible()
  await expect(page.getByText('1,67 €')).toBeVisible()

  // Default « Recommandé »: the near station beats the sticker-cheapest;
  // « Prix » flips back to the raw order
  await expect(rows(page).first()).toContainText('Station U · Croix-Blanche')
  await page.getByText('Prix', { exact: true }).click()
  await expect(rows(page).first()).toContainText('E.Leclerc · Labège')

  // Unpinning removes the row, and the removal survives a reload
  await page.getByRole('button', { name: 'Retirer E.Leclerc · Labège des favoris' }).click()
  await expect(page.getByText('1 station', { exact: true })).toBeVisible()
  await expect(page.getByText('E.Leclerc · Labège')).toHaveCount(0)

  await page.reload()
  await expect(rows(page).first()).toContainText('Station U · Croix-Blanche')
  await expect(page.getByText('E.Leclerc · Labège')).toHaveCount(0)
})
