import { test, expect, gotoMap } from './fixtures'

// The map mirrors its view and its filters into the query string, so the URL
// in the address bar is always a link to what is on screen — and opening such
// a link lands on the same area, fuel and filters, whatever the reader's own
// persisted settings say.

const params = (page: import('@playwright/test').Page) => new URL(page.url()).searchParams

test('the map writes its view into the URL', async ({ page }) => {
  await gotoMap(page)

  await expect.poll(() => params(page).get('ll')).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  await expect.poll(() => params(page).get('z')).not.toBeNull()
  expect(params(page).get('f')).toBe('diesel')
  expect(params(page).get('r')).toBe('5')
  expect(new URL(page.url()).pathname).toBe('/')
})

test('changing the fuel updates the link', async ({ page }) => {
  await gotoMap(page)
  await expect.poll(() => params(page).get('f')).toBe('diesel')

  await page.getByRole('button', { name: 'Gazole ↻' }).click()

  await expect(page.getByRole('button', { name: 'SP95-E10 ↻' })).toBeVisible()
  await expect.poll(() => params(page).get('f')).toBe('e10')
})

test('a shared link opens on its area, fuel and radius', async ({ page }) => {
  // ~1 km north-east of Toulouse Capitole (the demo dataset's center)
  await page.goto('/?ll=43.615,1.455&z=14&f=e85&r=3')

  await expect(page.getByText('dans cette zone')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'E85 ↻' })).toBeVisible()
  await expect(page.getByRole('button', { name: '< 3 km' })).toBeVisible()
  // The shared area survives the geolocation fix landing right after boot
  await page.waitForTimeout(1000)
  expect(params(page).get('ll')).toBe('43.615,1.455')
  expect(params(page).get('z')).toBe('14')
})

test('a shared link carries the filters it was shared with', async ({ page }) => {
  // 4 of the 6 stations in the default demo zone are open 24/24 (filters.spec)
  await page.goto('/?ll=43.6047,1.4442&z=13&f=diesel&r=5&s=open24h')

  await expect(page.getByText('Filtres · 4')).toBeVisible({ timeout: 15_000 })
})
