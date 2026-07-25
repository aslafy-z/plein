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
 * Current zoom level, read from the tile URLs (…/{z}/{x}/{y}.png).
 *
 * Leaflet keeps the outgoing level's tiles during a zoom animation, so the
 * tiles on screen span two levels — and the stale one is the HIGHER of the two
 * when zooming out. Reading the max across every tile therefore reports a
 * level the map is not at, for as long as the animation runs. Each level lives
 * in its own `.leaflet-tile-container`, scaled by `getZoomScale(current,
 * level)`: only the level the map is actually on is left at scale 1, which is
 * what identifies it here. Mid-animation no container qualifies, so the read
 * waits for the map to land instead of returning a lie.
 */
export async function tileZoom(page: import('@playwright/test').Page) {
  const live = await page.waitForFunction(() => {
    const zooms: number[] = []
    for (const el of document.querySelectorAll('.leaflet-tile-container')) {
      const t = getComputedStyle(el).transform
      // A container that is only translated has no scale in its matrix
      if (Math.abs((t === 'none' ? 1 : new DOMMatrixReadOnly(t).a) - 1) > 1e-3) continue
      for (const img of el.querySelectorAll('img')) {
        const m = (img as HTMLImageElement).src.match(/\/(\d+)\/\d+\/\d+(?:@2x)?\.png/)
        if (m) zooms.push(Number(m[1]))
      }
    }
    return zooms.length ? { zoom: Math.max(...zooms) } : null
  })
  return (await live.jsonValue()).zoom
}

export { expect }
