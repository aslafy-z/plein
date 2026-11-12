import { test, expect, gotoMap, openRouteSheet, pickRoutePlace } from './fixtures'

// A 20 % departure tank forces a plan on the Toulouse → Bordeaux demo
// corridor, so the whole flow — plan card, tour, fiche, history — has a
// planned stop to hang off. lastFix: the trip departs from « My position »,
// which needs a position the app actually has (the runner's Chromium never
// grants a fix, and without one the departure is unset).
test.use({
  seed: {
    sourceId: 'demo',
    onboarded: true,
    lastFix: { lat: 43.6047, lng: 1.4442 },
    startTankPct: 20,
  },
})

test('route comparison: map-first shell, tour, station detail and history', async ({ page }) => {
  await gotoMap(page)

  // ── The route shows the map from the first frame, form floating over it ──
  await page.getByText('Route', { exact: true }).click()
  await expect(page.locator('[aria-label="Map of the route"]')).toBeVisible()
  const cta = page.getByRole('button', { name: 'Compare the stations along the route' })
  await expect(cta).toBeVisible()

  // ── Compute a route: the seeded fix IS Toulouse, so pick a real
  // destination through the shared search field — picking submits ──
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')

  // ── Results in the same shell: planned stop, corridor map still up ──
  await expect(page.getByText('Recommended stop').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Map of the route"]')).toBeVisible()
  await openRouteSheet(page)
  await expect(page.getByText(/L to buy/).first()).toBeVisible()

  // strategy switch → the plan recomputes (same single fill here)
  await page.getByText('Lowest price').click()
  await expect(page.getByText('Recommended stop').first()).toBeVisible()

  // The trip CTA on the bottom edge hands Maps the whole plan — its stop
  // included before anything is pinned
  const startTrip = page.getByTestId('route-start-trip')
  await expect(startTrip).toHaveText('Start the trip · 1 stop')
  // pin the planned stop: the toggle flips, the trip keeps its one stop
  await page.getByRole('button', { name: 'Add to the trip' }).first().click()
  await expect(page.getByRole('button', { name: 'Remove from the trip' }).first()).toBeVisible()
  await expect(startTrip).toHaveText('Start the trip · 1 stop')
  await page.evaluate(() => {
    const w = window as unknown as { __opened: string[] }
    w.__opened = []
    window.open = (url?: string | URL) => {
      w.__opened.push(String(url))
      return null
    }
  })
  await startTrip.click()
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
  expect(opened).toHaveLength(1)
  expect(opened[0]).toContain('google.com/maps/dir/')
  expect(opened[0]).toContain('&waypoints=')

  // ── Station detail from the planned stop ──
  await page.getByRole('button', { name: /Details for/ }).first().click()
  // « Services » is the fiche section both arrangements render — the desktop
  // fiche has no mini-map
  await expect(page.getByText('Services')).toBeVisible()
  await expect(page.getByText(/Upd\. .+ ago/).first()).toBeVisible()
  // Desktop: the fiche stacks INSIDE the route panel — the reader stays in
  // the route view, corridor map up (a phone shows the fiche full screen)
  if ((await page.getByTestId('route-panel').count()) > 0) {
    await expect(page.locator('[aria-label="Map of the route"]')).toBeVisible()
  }
  await page.goBack()

  // ── One place history: the destination picked in the route search is
  // offered back by the MAP's search ──
  await page.getByText('Map', { exact: true }).click()
  await page.getByLabel('Search for a place').click()
  const suggestions = page.getByTestId('search-suggestions')
  await expect(suggestions.getByText('Recent')).toBeVisible()
  await expect(suggestions.getByText('Bordeaux centre')).toBeVisible()
})
