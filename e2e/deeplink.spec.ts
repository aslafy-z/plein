import { test, expect } from './fixtures'

// URL routing: /station/:id must open the fiche on a cold load. The stations
// arrive asynchronously, so the "unknown station" guard may only fire once the
// data has settled — and it must never pop the entry the app was opened on
// (that would eject the tab out of the app entirely).

test('a station deep link opens the fiche on a cold load', async ({ page }) => {
  await page.goto('/station/su')

  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('12 route de la Croix-Blanche · 31000 Toulouse')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/station/su')
})

test('the fiche survives a refresh', async ({ page }) => {
  await page.goto('/station/te')
  await expect(page.getByText('TotalEnergies · Centre')).toBeVisible({ timeout: 15_000 })

  await page.reload()
  await expect(page.getByText('TotalEnergies · Centre')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/station/te')
})

test('an unknown station falls back to the map without leaving the app', async ({ page }) => {
  await page.goto('/station/pas-une-station')

  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
  // The dead URL was swapped, not stacked: Back must not walk onto it again
  await expect(page).toHaveURL(/localhost:5173\/$/)
})

test('back from a deep-linked fiche returns to the map, in-app', async ({ page }) => {
  await page.goto('/station/su')
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Retour' }).click()

  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
})
