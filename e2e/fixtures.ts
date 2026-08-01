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
    // mid-animation. Network noise (including the dev server's HMR socket)
    // is expected when a spec cuts the source or goes offline.
    const ignored = /net::|Failed to load resource|ERR_|_leaflet_pos|WebSocket/
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

// ── Pre-seeding the durable station cache ────────────────────────────────────
// The settings blob goes in through `addInitScript`, but the station cache is
// IndexedDB (src/data/cacheStore.ts) and a write to it cannot be made to land
// before the app's own `open()` from a document-start script. So it is written
// from a page already on the origin, and the caller reloads into it.
//
// The record shape below mirrors `AreaMeta` / `areaKey` in
// src/data/stationsCache.ts — the two have to agree, and a mismatch shows up
// as a seeded area the app simply never finds.
export interface SeededArea {
  source: string
  center: { lat: number; lng: number }
  /** Radius the fetch is claimed to have covered, in km */
  fetchRadiusKm: number
  /** How old the data should look — what makes an aged area testable at all */
  ageMs: number
  stations: Record<string, unknown>[]
}

export async function seedStationsCache(
  page: import('@playwright/test').Page,
  areas: SeededArea[],
) {
  // The app boots on this load too; only the origin matters here, so it need
  // not be waited out.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (seeded) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('plein.cache', 1)
      req.onupgradeneeded = () => {
        for (const name of ['areas', 'payloads']) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['areas', 'payloads'], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      for (const area of seeded) {
        const key = `${area.source}|${area.center.lat.toFixed(4)},${area.center.lng.toFixed(4)}`
        tx.objectStore('payloads').put(area.stations, key)
        tx.objectStore('areas').put(
          {
            key,
            source: area.source,
            center: area.center,
            fetchRadiusKm: area.fetchRadiusKm,
            fetchedAt: Date.now() - area.ageMs,
            stationCount: area.stations.length,
            bytes: area.stations.length * 400,
          },
          key,
        )
      }
    })
    db.close()
  }, areas)
}

// The zone card appearing means stations are loaded and the map is live.
export async function gotoMap(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
}

// ── Which arrangement is under test ──────────────────────────────────────────
// The suite runs two projects, and they no longer see the same layout: below
// this width the zone is a bottom sheet dragged over the map, above it a panel
// docked beside it (src/lib/layout.ts — the two numbers must agree).
export const DESKTOP_MIN_WIDTH = 960

/**
 * Restricts a spec to the phone arrangement — for the gestures a window has
 * no equivalent of (dragging a sheet open, flicking it shut, tapping the
 * dimmed map behind it). Reads the project's own viewport rather than its
 * name, so renaming a project can't silently un-skip anything.
 *
 * Call at file or describe scope, before the tests.
 */
export function phoneOnly(reason = 'gesture of the phone arrangement — a window docks the list') {
  test.skip(({ viewport }) => viewport != null && viewport.width >= DESKTOP_MIN_WIDTH, reason)
}

/** The mirror image: a spec about the desktop arrangement only */
export function desktopOnly(reason = 'the desktop arrangement — a phone has no room for it') {
  test.skip(({ viewport }) => viewport == null || viewport.width < DESKTOP_MIN_WIDTH, reason)
}

/**
 * Reveal the zone's station list. On a phone it is what the bottom sheet
 * expands into, so its handle has to be tapped and the open animation waited
 * out; on a window it is docked beside the map and already on screen.
 */
export async function openZoneList(page: import('@playwright/test').Page) {
  const handle = page.getByRole('button', { name: /liste des stations/ })
  if ((await handle.count()) === 0) {
    await expect(page.getByTestId('zone-list')).toBeVisible()
    return
  }
  await handle.click()
  await expect(handle).toHaveAttribute('aria-expanded', 'true')
  await page.waitForTimeout(400) // the height transition (.3s) — rows must not move under a click
}

/** The reverse: collapse the sheet on a phone, nothing to do on a window. */
export async function closeZoneList(page: import('@playwright/test').Page) {
  const scrim = page.getByRole('button', { name: 'Fermer la liste' })
  if ((await scrim.count()) === 0) return
  // The scrim spans the whole stage but the expanded sheet (above it) covers
  // its center — Playwright's default click point. Tap near the top, on the
  // strip of dimmed map the sheet never reaches (≥ 64px stays free).
  await scrim.click({ position: { x: 40, y: 30 } })
  await expect(page.getByRole('button', { name: /liste des stations/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
}

/**
 * Fill a route endpoint field and pick a suggestion. The fields share the
 * map's search: on a window they are live inputs over the map (dropdown
 * attached under the box); on a phone each is a trigger opening the shared
 * full-screen search first.
 */
export async function pickRoutePlace(
  page: import('@playwright/test').Page,
  field: 'from' | 'to',
  text: string,
  pickLabel: string | RegExp,
) {
  const placeholder = field === 'from' ? 'Départ' : 'Destination'
  const input = page.getByPlaceholder(placeholder)
  if ((await input.count()) === 0) {
    await page.getByRole('button', { name: placeholder, exact: true }).click()
    await expect(input).toBeVisible()
  }
  await input.fill(text)
  await page
    .getByTestId('search-suggestions')
    .getByText(pickLabel)
    .first()
    .click({ timeout: 15_000 })
}

/**
 * Reveal the route sheet's expanded content (the form, or the timeline). On
 * a phone the collapsed sheet only shows its lead and the CTA; on a window
 * the floating panel already shows everything. The two aria labels share the
 * « détail de l'itinéraire » phrase, so one locator survives the toggle.
 */
export async function openRouteSheet(page: import('@playwright/test').Page) {
  const handle = page.getByRole('button', { name: /détail de l'itinéraire/ })
  if ((await handle.count()) === 0) return
  await handle.click()
  await expect(handle).toHaveAttribute('aria-expanded', 'true')
  await page.waitForTimeout(400) // the height transition (.3s)
}

/** Collapse the route sheet on a phone (the expanded sheet covers the
    endpoint fields); nothing to do on a window. */
export async function closeRouteSheet(page: import('@playwright/test').Page) {
  const handle = page.getByRole('button', { name: /détail de l'itinéraire/ })
  if ((await handle.count()) === 0) return
  if ((await handle.getAttribute('aria-expanded')) !== 'true') return
  await handle.click()
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
  await page.waitForTimeout(400)
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
