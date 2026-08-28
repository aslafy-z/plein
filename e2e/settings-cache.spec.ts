import { test, expect, gotoMap, openZoneList } from './fixtures'

// « Data » must be able to answer "what is this app keeping, and how do I
// get rid of it". Instrumentation here has to be data rather than console
// logs — the fixture fails any test whose page logs an error — so the readout
// IS the observability, and it is worth asserting.

test.use({ seed: { sourceId: 'demo', onboarded: true } })

const openSettings = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByTestId('cache-stats')).toBeVisible()
}

test('Settings reports the cached zones and clears them', async ({ page }) => {
  await gotoMap(page)
  // The area is written on idle; give the flush its window before reading back
  await page.waitForTimeout(1500)

  await openSettings(page)

  // « 1 area stored · 18 kB · oldest just now »
  await expect(page.getByTestId('cache-stats')).toContainText(/area stored|areas stored/)

  const clear = page.getByRole('button', { name: /Clear offline data/ })
  await expect(clear).toBeEnabled()
  await clear.click()

  await expect(page.getByTestId('cache-stats')).toHaveText('No area stored yet')
  // Nothing left to clear, and the settings themselves survived the wipe
  await expect(clear).toBeDisabled()
  await expect(page.getByRole('button', { name: /Demo data/ })).toBeVisible()

  // The map still works: the source is simply queried again. `.first()` —
  // the desktop rail also carries the brand button back to the map.
  await page.getByRole('button', { name: 'Map' }).first().click()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  await openZoneList(page)
})

test('the counter includes the basemap tiles, and « Clear » sweeps them too', async ({ page }) => {
  await gotoMap(page)
  // Let the area flush land before Settings opens, so nothing rewrites the
  // stations cache behind the clear below (same window as the test above)
  await page.waitForTimeout(1500)

  // The dev server never registers the worker, so Cache Storage starts empty
  // here: seed the tile cache the worker would have filled. The names mirror
  // src/lib/swCaches.ts — the current generation plus an abandoned one, which
  // survives until the next worker activates and must still be counted.
  await page.evaluate(async () => {
    const current = await caches.open('plein-tiles-v2')
    await current.put('https://a.basemaps.cartocdn.com/dark_all/5/16/11.png', new Response('t'))
    await current.put('https://a.basemaps.cartocdn.com/dark_all/5/17/11.png', new Response('t'))
    const stale = await caches.open('plein-tiles-v1')
    await stale.put('https://a.basemaps.cartocdn.com/dark_all/5/18/11.png', new Response('t'))
  })

  await openSettings(page)

  // « 3 map tiles · ≈ 59 kB » under the areas line
  await expect(page.getByTestId('cache-stats')).toContainText('3 map tiles')

  const clear = page.getByRole('button', { name: /Clear offline data/ })
  await expect(clear).toBeEnabled()
  await clear.click()

  await expect(page.getByTestId('cache-stats')).not.toContainText('map tile')
  await expect(clear).toBeDisabled()
  // Both generations are gone from Cache Storage itself, not just the readout
  expect(
    await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('plein-tiles-'))),
  ).toEqual([])
})
