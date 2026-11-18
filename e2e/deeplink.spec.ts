import { test, expect } from './fixtures'

// URL routing: /station/:id must open the fiche on a cold load. The stations
// arrive asynchronously, so the "unknown station" guard may only fire once the
// data has settled — and it must never pop the entry the app was opened on
// (that would eject the tab out of the app entirely).

test('a station deep link opens the fiche on a cold load', async ({ page }) => {
  await page.goto('/station/su')

  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('12 route de la Croix-Blanche · 31000 Toulouse')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/station/su')
})

test('the fiche survives a refresh', async ({ page }) => {
  await page.goto('/station/te')
  await expect(page.getByText('TotalEnergies · Centre').first()).toBeVisible({ timeout: 15_000 })

  await page.reload()
  await expect(page.getByText('TotalEnergies · Centre').first()).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/station/te')
})

test('an unknown station falls back to the map without leaving the app', async ({ page }) => {
  await page.goto('/station/pas-une-station')

  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
  // The dead URL was swapped, not stacked: Back must not walk onto it again
  // (the map carries its shareable view in the query string)
  await expect(page).toHaveURL(/localhost:5173\/(\?.*)?$/)
})

test('back from a deep-linked fiche returns to the map, in-app', async ({ page }) => {
  await page.goto('/station/su')
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible({ timeout: 15_000 })

  // « Back » on the phone's full-screen fiche, a close cross on desktop
  await page.getByRole('button', { name: /^(Back|Close the station page)$/ }).click()

  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
})

test('?debug=1 on a deep link stays in the address bar and survives navigation', async ({ page }) => {
  await page.goto('/station/su?debug=1')
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('debug-chip').or(page.getByTestId('debug-panel'))).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/station/su')
  expect(new URL(page.url()).searchParams.get('debug')).toBe('1')

  // Leaving the fiche rewrites the query from app state: the flag rides along
  await page.getByRole('button', { name: /^(Back|Close the station page)$/ }).click()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => new URL(page.url()).searchParams.get('debug')).toBe('1')
  expect(new URL(page.url()).searchParams.get('ll')).not.toBeNull()
})
