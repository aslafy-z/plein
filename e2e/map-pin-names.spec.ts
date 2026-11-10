import { test, expect, gotoMap, phoneOnly, pickRoutePlace } from './fixtures'

// Leaflet turns every marker into a `tabindex=0 role=button` unless told
// otherwise. A station pin IS a button (it selects / opens its station), so it
// is named after the station — not after the bare price its bubble shows. The
// markers that do nothing (route endpoints, the range limit, the fiche's
// mini-map pin, the user dot) are not tab stops at all.
//
// The pins are zero-size anchors (the bubble overflows them), so these read
// attributes and counts rather than visibility.

// Same seed as route.spec.ts: a 20 % departure tank forces a planned stop on
// the Toulouse → Bordeaux demo corridor, and the trip needs a real fix.
test.use({
  seed: {
    sourceId: 'demo',
    onboarded: true,
    lastFix: { lat: 43.6047, lng: 1.4442 },
    startTankPct: 20,
  },
})

/** A focusable marker nobody named — what a screen reader calls « button » */
const NAMELESS_TAB_STOP = '.leaflet-marker-icon[tabindex]:not([aria-label])'

test('a station pin is a button named after its station and price', async ({ page }) => {
  await gotoMap(page)

  // The demo zone recommends Station U · Croix-Blanche, so it wears a bubble
  const pin = page.locator('.leaflet-marker-icon[aria-label^="Station U · Croix-Blanche, "]')
  await expect(pin).toHaveCount(1)
  await expect(pin).toHaveAttribute('role', 'button')
  await expect(pin).toHaveAttribute('tabindex', '0')
  await expect(pin).toHaveAttribute(
    'aria-label',
    /^Station U · Croix-Blanche, \d\.\d\d € per litre$/,
  )

  // …and nothing else on the map is a tab stop without a name (the user dot
  // and the reticle are not focusable)
  await expect(page.locator(NAMELESS_TAB_STOP)).toHaveCount(0)
})

test('on the route map only the stop pins are tab stops, and they are named', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('Recommended stop').first()).toBeVisible({ timeout: 30_000 })

  const routeMap = page.locator('[aria-label="Map of the route"]')
  // Stop pins: named buttons
  const stops = routeMap.locator('.leaflet-marker-icon[role="button"]')
  await expect(stops.first()).toHaveAttribute('aria-label', /^.+, \d\.\d\d € per litre$/)
  // Endpoints, range limit, user dot: drawn, but neither buttons nor tab stops
  await expect(routeMap.locator('.leaflet-marker-icon:not([role="button"])').first()).toBeAttached()
  await expect(routeMap.locator('.leaflet-marker-icon:not([role="button"])[tabindex]')).toHaveCount(0)
  await expect(routeMap.locator(NAMELESS_TAB_STOP)).toHaveCount(0)
})

test.describe('mini-map pin', () => {
  phoneOnly('the desktop fiche has no mini-map')

  test('the fiche pin is decoration, not a tab stop', async ({ page }) => {
    await page.goto('/station/su')
    await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

    const marker = page.locator('[aria-label="Map of the station"] .leaflet-marker-icon')
    await expect(marker).toHaveCount(1)
    await expect(marker).not.toHaveAttribute('tabindex', /.*/)
    await expect(marker).not.toHaveAttribute('role', 'button')
  })
})
