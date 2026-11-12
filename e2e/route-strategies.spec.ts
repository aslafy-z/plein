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

test.describe('with a 60 % tank asked for on arrival', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: true, lastFix: TOULOUSE, arrivalTankPct: 60 } })

  test('a trip the tank covers still plans the stop that delivers the arrival floor', async ({
    page,
  }) => {
    // The default 70 % tank reaches Bordeaux without stopping (route-share
    // pins « No fuel stop needed ») — but lands near 40 %, under the floor
    await computeBordeauxRoute(page)
    await expect(page.getByText('Recommended stop').first()).toBeVisible({ timeout: 30_000 })
    await openRouteSheet(page)
    await expect(page.getByText(/L left on arrival/)).toBeVisible()
  })

  test('the floor is set from the route form and travels in the trip link', async ({ page }) => {
    await gotoMap(page)
    await page.getByText('Route', { exact: true }).click()
    await openRouteSheet(page)
    const slider = page.getByRole('slider', { name: 'Tank on arrival' })
    await expect(slider).toHaveValue('60')
    await slider.fill('0')
    await closeRouteSheet(page)
    await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
    await expect(page.getByText('No fuel stop needed').first()).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => new URL(page.url()).searchParams.get('ap')).toBe('0')
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
  await expect(page.getByTestId('plan-alternative').first()).toBeVisible()
  await expect(page.getByText('Recommended stop')).toHaveCount(0)
  // A stop-free trip still starts from the bottom edge — straight to the arrival
  await expect(page.getByTestId('route-start-trip')).toHaveText('Start the trip')
})

test('a low departure tank caps the autonomy and plans a reachable stop', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  // The tank slider lives in the sheet's expanded form on a phone — reveal
  // it; the CTA stays reachable either way (pinned to the bottom edge).
  await openRouteSheet(page)
  // « Tank at departure » 10 % → 5 L / 6.5 L/100 km ≈ 77 km, limit 60 km
  await page.getByRole('slider', { name: 'Tank at departure' }).fill('10')
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

  // One road from departure to arrival: the plan's stop, the alternatives
  // and the dry point in kilometre order, nothing listed past the arrival
  await expect(page.getByTestId('plan-alternative').first()).toBeVisible()
  const line = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="plan-stop"], [data-testid="plan-alternative"], [data-testid="limit-marker"], [data-testid="route-arrival"]',
      ),
    ].map((n) => ({
      kind: (n as HTMLElement).dataset.testid,
      km: Number(/KM (\d+)/.exec(n.textContent ?? '')?.[1]),
    })),
  )
  expect(line.at(-1)?.kind).toBe('route-arrival')
  const kms = line.slice(0, -1).map((e) => e.km)
  expect(kms.every((km) => Number.isFinite(km))).toBe(true)
  expect(kms).toEqual([...kms].sort((a, b) => a - b))
  expect(line.map((e) => e.kind)).toContain('limit-marker')
})

test.describe('a vehicle that cannot bridge the corridor gaps', () => {
  test.use({
    seed: {
      sourceId: 'demo', onboarded: true, lastFix: TOULOUSE,
      // The thirstiest vehicle the Settings sliders allow — persist.ts drops
      // anything beyond them on the way in
      tank: 5, consumption: 12, startTankPct: 40,
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
