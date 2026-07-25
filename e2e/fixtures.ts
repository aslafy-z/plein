import { test as base, expect } from '@playwright/test'

// Tests run against the deterministic demo data source by default; `seed` is
// the persisted settings blob installed before the app boots. Storage is only
// cleared on the first load of each test — reloads must keep app state.
type Options = { seed: Record<string, unknown> }

// The app picks its language from the browser unless the blob names one.
// Assertions here read French, so the locale is pinned for every test rather
// than left to depend on the browser's — `playwright.config.ts` happens to ask
// for fr-FR too, and one of those two must not silently become the reason the
// suite passes. A spec picks another language through `seed`, or drops the pin
// entirely with `locale: null` to exercise the detection path.
const BASE_SEED = { locale: 'fr' }

/** `locale: null` in a seed means « no explicit choice », not « choose null » */
function dropNullLocale(settings: Record<string, unknown>): Record<string, unknown> {
  if (settings.locale != null) return settings
  const { locale: _dropped, ...rest } = settings
  return rest
}

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
    }, dropNullLocale({ ...BASE_SEED, ...seed }))

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
 * Zoom the map has landed on, read from the `data-zoom` the map publishes on
 * its container (MapCanvas). The attribute is absent while a zoom animation
 * runs, so this waits for the map to settle rather than reporting a level it
 * is only passing through.
 */
export async function mapZoom(page: import('@playwright/test').Page) {
  const landed = await page.waitForFunction(() => {
    const z = document.querySelector('.leaflet-container[data-zoom]')?.getAttribute('data-zoom')
    return z == null ? null : { zoom: Number(z) }
  })
  return (await landed.jsonValue()).zoom
}

export { expect }
