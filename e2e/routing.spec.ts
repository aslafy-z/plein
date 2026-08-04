import { test, expect, gotoMap } from './fixtures'

// URL routing (`pathFor` / `navFromPath` and the history effects in the store):
// every screen owns a URL, a refresh lands back on the screen it was taken on,
// and the system back button walks the app instead of leaving it. The fiche
// deep links have their own file (deeplink.spec.ts).

const TABS = [
  { path: '/favorites', marker: 'The stations you use, at today\'s price.' },
  { path: '/route', marker: 'Compare the stations along the route' },
  { path: '/settings', marker: 'Default fuel' },
]

for (const { path, marker } of TABS) {
  test(`${path} opens its tab on a cold load and survives a refresh`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe(path)

    await page.reload()
    await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe(path)
  })
}

test('the map keeps its shareable view across a refresh', async ({ page }) => {
  test.slow() // two full map boots, and the URL write is throttled
  await gotoMap(page)
  // The map publishes its area in the query string, so a refresh must reopen
  // the very same view, not a bare `/`.
  await expect(page).toHaveURL(/\/\?.*ll=/)
  const url = page.url()

  await page.reload()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
  expect(new URL(page.url()).searchParams.get('ll')).toBe(new URL(url).searchParams.get('ll'))
})

test('/list, the pre-Favorites URL, still opens Favorites', async ({ page }) => {
  await page.goto('/list')

  await expect(page.getByText('The stations you use, at today\'s price.')).toBeVisible({
    timeout: 15_000,
  })
  // …under the current URL: the legacy entry is rewritten, not kept alive
  expect(new URL(page.url()).pathname).toBe('/favorites')
})

test('a tab reached by tapping the nav bar owns its URL', async ({ page }) => {
  await gotoMap(page)

  await page.getByText('Favorites', { exact: true }).click()
  await expect(page.getByText("No favorites yet")).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/favorites')

  await page.getByText('Route', { exact: true }).click()
  await expect(page.getByText('Compare the stations along the route')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/route')

  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByText('Default fuel')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/settings')
})

test('browser back walks the fiche and the tabs, in-app', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByText('Default fuel')).toBeVisible()

  await page.getByText('Map', { exact: true }).click()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await page.getByText(/Upd\. /).first().click()
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/station/su')

  await page.goBack()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')

  await page.goBack()
  await expect(page.getByText('Default fuel')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/settings')
})

test('back closes the filters sheet rather than leaving the map', async ({ page }) => {
  await gotoMap(page)
  const sheet = page.getByRole('button', { name: 'Close the filters' })

  await page.getByText(/^Filters · /).click()
  await expect(sheet).toBeVisible()

  await page.goBack()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByText('The cheapest near you')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
})

test('closing the sheet from the UI leaves no entry to re-close', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Settings', { exact: true }).click()
  await expect(page.getByText('Default fuel')).toBeVisible()
  await page.getByText('Map', { exact: true }).click()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })

  const sheet = page.getByRole('button', { name: 'Close the filters' })
  await page.getByText(/^Filters · /).click()
  await expect(sheet).toBeVisible()
  await page.getByText(/^Show \d+ station/).click()
  await expect(sheet).toHaveCount(0)

  // Opening the sheet pushed an entry and closing it popped that entry back
  // off: Back walks to the previous screen instead of re-closing a sheet that
  // is already closed.
  await page.goBack()
  await expect(page.getByText('Default fuel')).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/settings')
})

test.describe('leaving onboarding', () => {
  test.use({ seed: { sourceId: 'demo' } })

  test('is not back-navigable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()
    const depth = await page.evaluate(() => history.length)

    await page.getByText('Continue without location').click()
    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })

    // The walkthrough's entry was swapped for the map, not stacked under it —
    // Back must never drop a returning user back into onboarding.
    expect(await page.evaluate(() => history.length)).toBe(depth)
    expect(new URL(page.url()).pathname).toBe('/')
  })
})
