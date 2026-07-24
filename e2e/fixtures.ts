import { test as base, expect } from '@playwright/test'

// Tests run against the deterministic demo data source by default; `seed` is
// the persisted settings blob installed before the app boots. Storage is only
// cleared on the first load of each test — reloads must keep app state.
type Options = { seed: Record<string, unknown> }

export const test = base.extend<Options>({
  seed: [{ sourceId: 'demo', onboarded: true }, { option: true }],

  page: async ({ page, seed }, use) => {
    // `_leaflet_pos` is Leaflet's zoom-transition vs map.remove() race
    // (leaflet#8410): harmless, fires when a screen change unmounts the map
    // mid-animation. Network noise is expected offline (demo fallback).
    const ignored = /net::|Failed to load resource|ERR_|_leaflet_pos/
    const errors: string[] = []
    page.on('pageerror', (e) => {
      if (!ignored.test(String(e))) errors.push(String(e))
    })
    page.on('console', (m) => {
      if (m.type() === 'error' && !ignored.test(m.text())) errors.push(m.text())
    })

    await page.addInitScript((settings) => {
      if (sessionStorage.getItem('e2e-init')) return
      sessionStorage.setItem('e2e-init', '1')
      localStorage.clear()
      localStorage.setItem('plein.settings.v1', JSON.stringify(settings))
    }, seed)

    await use(page)

    expect(errors, 'the page must not throw').toEqual([])
  },
})

// The bottom sheet appearing means stations are loaded and the map is live.
export async function gotoMap(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
}

/**
 * Current zoom level, read from the tile URLs (…/{z}/{x}/{y}.png). Max across
 * the tiles: during (and right after) an animation Leaflet still holds the
 * outgoing level's tiles, so a settle-and-retry is the caller's job.
 */
export async function tileZoom(page: import('@playwright/test').Page) {
  const srcs = await page
    .locator('.leaflet-tile')
    .evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
  const zooms = srcs
    .map((s) => s.match(/\/(\d+)\/\d+\/\d+(?:@2x)?\.png/))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => Number(m[1]))
  if (!zooms.length) throw new Error('no tiles on the map')
  return Math.max(...zooms)
}

export { expect }
