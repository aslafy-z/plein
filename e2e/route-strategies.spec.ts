import { test, expect, gotoMap, closeRouteSheet, openRouteSheet, pickRoutePlace } from './fixtures'

// The optimizer itself is unit-tested (src/lib/routeOptimizer.test.ts) and the
// demo-corridor plans are pinned in src/lib/routeCandidates.test.ts — this
// checks the WIRING on the deterministic Toulouse → Bordeaux demo corridor:
// the strategy chips really swap the computed plan, a multi-stop plan renders
// in driving order, the zero-stop and infeasible states render, and the copy
// comes from the catalogs.

// lastFix: every trip below departs from « My position », and that means a
// position the app actually has — a fix the runner's Chromium never grants,
// so it is seeded. Without one the departure is unset and no route computes.
const TOULOUSE = { lat: 43.6047, lng: 1.4442 }

test.use({ seed: { sourceId: 'demo', onboarded: true, lastFix: TOULOUSE } })

async function computeBordeauxRoute(page: import('@playwright/test').Page) {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()
  // Picking the destination submits the trip on its own — no CTA tap
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
}

test.describe('with a 20 % departure tank', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: true, lastFix: TOULOUSE, startTankPct: 20 } })

  test('the strategy chips swap the displayed plan', async ({ page }) => {
    await computeBordeauxRoute(page)

    // « Best trade-off » (default) → a single stop, price AND detour weighed,
    // stating the litres to buy there
    await expect(page.getByText('Recommended stop').first()).toBeVisible({ timeout: 30_000 })
    await openRouteSheet(page)
    await expect(page.getByRole('button', { name: /^Details for/ })).toContainText(
      "Leclerc · Valence-d'Agen",
    )
    await expect(page.getByText(/L to buy/).first()).toBeVisible()

    // « Least detour » → the on-motorway station wins despite its price
    await page.getByText('Least detour').click()
    await expect(page.getByRole('button', { name: /^Details for/ })).toContainText(
      'Total Relais · A62',
    )

    // The demo source has no routing matrix → the plan says so
    await expect(page.getByTestId('plan-estimated')).toBeVisible()
  })
})

test.describe('with a small 15 L tank', () => {
  test.use({
    seed: { sourceId: 'demo', onboarded: true, lastFix: TOULOUSE, tank: 15, startTankPct: 20 },
  })

  test('a multi-stop plan renders in driving order', async ({ page }) => {
    await computeBordeauxRoute(page)
    await expect(page.getByText('Stop 1/2').first()).toBeVisible({ timeout: 30_000 })
    await openRouteSheet(page)
    await expect(page.getByText('Stop 2/2')).toBeVisible()
    const stops = page.getByRole('button', { name: /^Details for/ })
    await expect(stops.nth(0)).toContainText('Total Access · Tournefeuille')
    await expect(stops.nth(1)).toContainText("Leclerc · Valence-d'Agen")
  })
})

test('a sufficient tank crosses without any stop — stations stay optional', async ({ page }) => {
  // Default seed: 70 % of 50 L ≈ 538 km of autonomy for ~264 km of route
  await computeBordeauxRoute(page)
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
  await openRouteSheet(page)
  await expect(page.getByText(/left on arrival/)).toBeVisible()
  // Cheap corridor stations are still browsable, but never crowned
  await expect(page.getByText('Other stations on the route')).toBeVisible()
  await expect(page.getByText('Recommended stop')).toHaveCount(0)
})

test('a low departure tank caps the autonomy and plans a reachable stop', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  // The tank slider lives in the sheet's expanded form on a phone — reveal
  // it; the CTA stays reachable either way (pinned to the bottom edge).
  await openRouteSheet(page)
  // « Tank at departure » 10 % → 5 L / 6.5 L/100 km ≈ 77 km, limit 60 km
  await page.locator('input[type=range]').fill('10')
  // The expanded sheet covers the endpoint fields on a phone — fold it back
  await closeRouteSheet(page)
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('Recommended stop').first()).toBeVisible({ timeout: 30_000 })
  await openRouteSheet(page)

  await expect(page.getByText('Tank 10 % · range ≈ 77 km')).toBeVisible()
  // The plan MUST open before the limit: Grisolles (KM ~43), one honest fill
  await expect(page.getByRole('button', { name: /^Details for/ })).toContainText(
    'Intermarché · Grisolles',
  )
  // The dry-point marker still sits on the timeline
  await expect(page.getByText(/range limit without stopping/)).toBeVisible()
})

test.describe('a vehicle that cannot bridge the corridor gaps', () => {
  test.use({
    seed: {
      sourceId: 'demo', onboarded: true, lastFix: TOULOUSE,
      tank: 10, consumption: 17, startTankPct: 40,
    },
  })

  test('renders an actionable infeasible state instead of a fake plan', async ({ page }) => {
    await computeBordeauxRoute(page)
    await expect(page.getByText('Not enough range for this trip').first()).toBeVisible({
      timeout: 30_000,
    })
    await openRouteSheet(page)
    await expect(page.getByText(/without eating into the reserve/)).toBeVisible()
    // The arrival row says why there is no ETA
    await expect(page.getByText(/not enough range \(limit/)).toBeVisible()
    // And no stop is crowned
    await expect(page.getByText('Recommended stop')).toHaveCount(0)
  })
})
