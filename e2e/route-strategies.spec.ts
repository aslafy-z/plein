import { test, expect, gotoMap } from './fixtures'

// The optimizer itself is unit-tested (src/lib/routeOptimizer.test.ts) and the
// demo-corridor plans are pinned in src/lib/routeCandidates.test.ts — this
// checks the WIRING on the deterministic Toulouse → Bordeaux demo corridor:
// the strategy chips really swap the computed plan, a multi-stop plan renders
// in driving order, the zero-stop and infeasible states render, and the copy
// comes from the catalogs.

async function computeBordeauxRoute(page: import('@playwright/test').Page) {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()
  await page.locator('input[placeholder="Destination"]').fill('Bordeaux')
  await page.getByText('Bordeaux centre').click()
  await page.getByText('Comparer les stations sur le trajet').click()
}

test.describe('with a 20 % departure tank', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: true, startTankPct: 20 } })

  test('the strategy chips swap the displayed plan', async ({ page }) => {
    await computeBordeauxRoute(page)

    // Meilleur compromis (default) → a single stop, price AND detour weighed
    await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Fiche de/ })).toContainText(
      "Leclerc · Valence-d'Agen",
    )

    // Prix le + bas → two stops in driving order: a top-up at Valence, the
    // bulk at Langon — with litres and cost per stop
    await page.getByText('Prix le + bas').click()
    await expect(page.getByText('Arrêt 1/2')).toBeVisible()
    await expect(page.getByText('Arrêt 2/2')).toBeVisible()
    const stops = page.getByRole('button', { name: /^Fiche de/ })
    await expect(stops.nth(0)).toContainText("Leclerc · Valence-d'Agen")
    await expect(stops.nth(1)).toContainText('Super U · Langon')
    await expect(page.getByText(/L à acheter/).first()).toBeVisible()

    // Détour min. → the on-motorway station wins despite its price
    await page.getByText('Détour min.').click()
    await expect(page.getByRole('button', { name: /^Fiche de/ })).toContainText(
      'Total Relais · A62',
    )

    // The demo source has no routing matrix → the plan says so
    await expect(page.getByTestId('plan-estimated')).toBeVisible()
  })
})

test('a sufficient tank crosses without any stop — stations stay optional', async ({ page }) => {
  // Default seed: 70 % of 50 L ≈ 538 km of autonomy for ~264 km of route
  await computeBordeauxRoute(page)
  await expect(page.getByText('Aucun arrêt carburant nécessaire')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/restants à l'arrivée/)).toBeVisible()
  // Cheap corridor stations are still browsable, but never crowned
  await expect(page.getByText('Autres stations sur le trajet')).toBeVisible()
  await expect(page.getByText('Arrêt conseillé')).toHaveCount(0)
})

test('a low departure tank caps the autonomy and plans reachable stops in order', async ({
  page,
}) => {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()

  // Réservoir au départ 10 % → 5 L / 6,5 L/100 km ≈ 77 km, limite 60 km
  await page.locator('input[type=range]').fill('10')
  await page.locator('input[placeholder="Destination"]').fill('Bordeaux')
  await page.getByText('Bordeaux centre').click()
  await page.getByText('Comparer les stations sur le trajet').click()

  await expect(page.getByText('Réservoir 10 % · autonomie ≈ 77 km')).toBeVisible({
    timeout: 30_000,
  })
  // The plan MUST open before the limit: Grisolles (KM ~43), then Langon
  await expect(page.getByText('Arrêt 1/2')).toBeVisible()
  const stops = page.getByRole('button', { name: /^Fiche de/ })
  await expect(stops.nth(0)).toContainText('Intermarché · Grisolles')
  await expect(stops.nth(1)).toContainText('Super U · Langon')
  // The dry-point marker sits on the timeline between the two
  await expect(page.getByText(/limite d'autonomie/)).toBeVisible()
})

test.describe('a vehicle that cannot bridge the corridor gaps', () => {
  test.use({
    seed: { sourceId: 'demo', onboarded: true, tank: 10, consumption: 17, startTankPct: 40 },
  })

  test('renders an actionable infeasible state instead of a fake plan', async ({ page }) => {
    await computeBordeauxRoute(page)
    await expect(page.getByText('Autonomie insuffisante pour ce trajet')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/sans entamer la réserve/)).toBeVisible()
    // The arrival row says why there is no ETA
    await expect(page.getByText(/autonomie insuffisante \(limite/)).toBeVisible()
    // And no stop is crowned
    await expect(page.getByText('Arrêt conseillé')).toHaveCount(0)
  })
})
