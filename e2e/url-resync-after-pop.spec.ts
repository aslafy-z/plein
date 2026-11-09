import { test, expect, gotoMap } from './fixtures'

// The filters and the place search each stack a history entry, and closing
// them from the UI pops it. Whatever changed while they were open was written
// onto THEIR entry — so the map entry the pop lands on must be re-synced, or
// the address bar goes back to the previous fuel / area and a reload (where
// the URL beats the persisted settings) undoes the choice. Both overlays close
// the same way in both arrangements, so this runs on phone and desktop.

const params = (page: import('@playwright/test').Page) => new URL(page.url()).searchParams

test('a fuel picked in the filters is still in the URL once they close', async ({ page }) => {
  await gotoMap(page)
  await expect.poll(() => params(page).get('f')).toBe('diesel')

  await page.getByText('Filters · 6').click()
  // 4 of the 6 zone stations sell E85 (filters.spec)
  await page.getByRole('button', { name: 'E85', exact: true }).click()
  await page.getByText('Show 4 stations').click()
  await expect(page.getByRole('button', { name: 'E85 ↻' })).toBeVisible()

  await expect.poll(() => params(page).get('f')).toBe('e85')
  // The popped entry was rewritten in place, not replaced by a filters one
  expect(await page.evaluate(() => !!window.history.state?.filtersOpen)).toBe(false)
  expect(new URL(page.url()).pathname).toBe('/')

  // The URL wins over the persisted fuel on load: a stale `f=diesel` here
  // would bring Diesel back
  await page.reload()
  await expect(page.getByRole('button', { name: 'E85 ↻' })).toBeVisible({ timeout: 15_000 })
})

test('a searched place is still in the URL once the search closes', async ({ page }) => {
  await gotoMap(page)
  await expect.poll(() => params(page).get('ll')).not.toBeNull()
  const home = params(page).get('ll')

  await page.getByLabel('Search for a place').click()
  await page.getByPlaceholder('Town, address…').fill('Marseille')
  await page.getByText(/see the stations here/).first().click()
  await expect(page.getByPlaceholder('Town, address…')).toHaveCount(0)
  await expect(page.getByText(/in this area/).first()).toBeVisible({ timeout: 15_000 })

  // Marseille in the demo geocoder (src/data/demo/demoData.ts)
  await expect.poll(() => params(page).get('ll')).toBe('43.2965,5.3698')
  expect(params(page).get('ll')).not.toBe(home)
  expect(await page.evaluate(() => window.history.state?.searchOpen ?? null)).toBeNull()
})
