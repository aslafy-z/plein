import { test, expect } from './fixtures'

// When the gouv APIs are unreachable, the app must fall back to demo data with
// a visible banner. Online, the real source loads without it. Either outcome
// is a pass; a broken map is the failure.
test.use({ seed: { sourceId: 'fra', onboarded: true } })

test('gouv source yields a usable map (live data, or demo fallback with banner)', async ({ page }) => {
  // The live attempt can take a while before the demo fallback kicks in
  // (sandboxed runners reach gouv through a slow proxy, if at all).
  test.setTimeout(120_000)
  await page.goto('/')

  const usable = page
    .getByText('La moins chère près de vous')
    .or(page.getByText('Aucune station ne correspond'))
  await expect(usable.first()).toBeVisible({ timeout: 90_000 })
})

test.describe('Auto source', () => {
  // Seeded at the Le Perthus border crossing: the auto source may draw both
  // French and Spanish stations there (live, or demo fallback offline).
  test.use({
    seed: {
      sourceId: 'auto',
      onboarded: true,
      lastPos: { lat: 42.463, lng: 2.865 },
    },
  })

  test('auto source yields a usable map (live data, or demo fallback with banner)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')

    const usable = page
      .getByText('La moins chère près de vous')
      .or(page.getByText('Aucune station ne correspond'))
    await expect(usable.first()).toBeVisible({ timeout: 90_000 })
  })
})

test.describe('Spanish source', () => {
  // Same contract for the Spanish flux, centered on Madrid so the searched
  // zone actually intersects Spanish provinces.
  test.use({
    seed: {
      sourceId: 'esp',
      onboarded: true,
      lastPos: { lat: 40.4168, lng: -3.7038 },
    },
  })

  test('esp source yields a usable map (live data, or demo fallback with banner)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')

    const usable = page
      .getByText('La moins chère près de vous')
      .or(page.getByText('Aucune station ne correspond'))
    await expect(usable.first()).toBeVisible({ timeout: 90_000 })
  })
})
