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

test('a shared link area survives the container resizing right after load', async ({ page }) => {
  await page.goto('/?ll=43.615,1.455&z=14&f=diesel&r=5')
  await expect(page.getByText('dans cette zone')).toBeVisible({ timeout: 15_000 })

  // The mobile URL bar collapsing (or a window resize) grows the map container.
  // The center-keeping pan of invalidateSize must stay programmatic: read as a
  // user pan, it committed the visible-center offset into the search area and
  // `ll` walked away from the link by half a sheet on every reload.
  const size = page.viewportSize()!
  await page.setViewportSize({ width: size.width, height: size.height + 56 })
  await page.waitForTimeout(1200)
  expect(params(page).get('ll')).toBe('43.615,1.455')
  expect(params(page).get('z')).toBe('14')
})

test('a shared link carries the filters it was shared with', async ({ page }) => {
  // 4 of the 6 stations in the default demo zone are open 24/24 (filters.spec)
  await page.goto('/?ll=43.6047,1.4442&z=13&f=diesel&r=5&s=open24h')

  await expect(page.getByText('Filtres · 4')).toBeVisible({ timeout: 15_000 })
})

test('a shared link carries the AdBlue filter, and an unknown tag never applies', async ({
  page,
}) => {
  // 2 of those 6 dispense AdBlue
  await page.goto('/?ll=43.6047,1.4442&z=13&f=diesel&r=5&s=adBlue')
  await expect(page.getByText('Filtres · 2')).toBeVisible({ timeout: 15_000 })

  // A tag no build ever had is dropped rather than emptying the map
  await page.goto('/?ll=43.6047,1.4442&z=13&f=diesel&r=5&s=hydrogenPump')
  await expect(page.getByText('Filtres · 6')).toBeVisible({ timeout: 15_000 })
})
