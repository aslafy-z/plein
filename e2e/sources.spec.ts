import { test, expect } from './fixtures'

// When the gouv APIs are unreachable, the app must own up with its explicit
// source-down (or offline) state — never demo data. Online, the real source
// loads. Either outcome is a pass; a broken map is the failure.

// A usable map = the collapsed card crowned a station — with LIVE data the
// recommended one is often not the sticker-cheapest, so all four header
// variants count — or one of the honest empty states (filters, source down,
// offline).
async function expectUsableMap(page: import('@playwright/test').Page) {
  const usable = page
    .getByText(/^The (cheapest|best choice) (near you|in this area)$/)
    .or(page.getByText('No station matches'))
    .or(page.getByText('The stations for this area could not be loaded.'))
    .or(page.getByText('Offline — no stations stored for this area.'))
  await expect(usable.first()).toBeVisible({ timeout: 90_000 })
}

test.use({ seed: { sourceId: 'fr', onboarded: true } })

test('gouv source yields a usable map (live data, or the explicit source-down state)', async ({ page }) => {
  // The live attempt can take a while before it settles either way
  // (sandboxed runners reach gouv through a slow proxy, if at all).
  test.setTimeout(120_000)
  await page.goto('/')
  await expectUsableMap(page)
})

test.describe('Auto source', () => {
  // Seeded at the Le Perthus border crossing: the auto source may draw both
  // French and Spanish stations there when it loads.
  test.use({
    seed: {
      sourceId: 'auto',
      onboarded: true,
      lastPos: { lat: 42.463, lng: 2.865 },
    },
  })

  test('auto source yields a usable map (live data, or the explicit source-down state)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await expectUsableMap(page)
  })
})

test.describe('Andorran source', () => {
  // Same contract for the Andorran flux, centered on Andorra la Vella.
  test.use({
    seed: {
      sourceId: 'ad',
      onboarded: true,
      lastPos: { lat: 42.5063, lng: 1.5218 },
    },
  })

  test('and source yields a usable map (live data, or the explicit source-down state)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await expectUsableMap(page)
  })
})

test.describe('Portuguese source', () => {
  // Same contract for the DGEG flux, centered on Lisboa so the searched zone
  // actually intersects a Portuguese district.
  test.use({
    seed: {
      sourceId: 'pt',
      onboarded: true,
      lastPos: { lat: 38.7223, lng: -9.1393 },
    },
  })

  test('pt source yields a usable map (live data, or the explicit source-down state)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await expectUsableMap(page)
  })
})

test.describe('Spanish source', () => {
  // Same contract for the Spanish flux, centered on Madrid so the searched
  // zone actually intersects Spanish provinces.
  test.use({
    seed: {
      sourceId: 'es',
      onboarded: true,
      lastPos: { lat: 40.4168, lng: -3.7038 },
    },
  })

  test('es source yields a usable map (live data, or the explicit source-down state)', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await expectUsableMap(page)
  })
})
