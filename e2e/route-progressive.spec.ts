import { test, expect } from './fixtures'
import type { Page, Route } from '@playwright/test'

// The route is computed in two stages and committed twice: the itinerary as
// soon as the routing engine answers, the corridor stations after. These specs
// pin the consequences — the trip is readable before any station is known, a
// recompute never blanks what is on screen, and a stage that fails is reported
// where it failed instead of being papered over.
//
// Every endpoint is stubbed, so the window between the two stages is a fixed
// number here rather than whatever the public servers happen to do.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

const BORDEAUX = { lat: 44.8378, lng: -0.5792 }
const NANTES = { lat: 47.2184, lng: -1.5536 }
const TOULOUSE = { lat: 43.6045, lng: 1.4442 }

/**
 * The visible copy of a sentence. The polite live region carries the same
 * words, by design, so a bare getByText matches twice — and the region sits
 * above the notices and the timeline in the DOM.
 */
const shown = (page: Page, text: string | RegExp) => page.getByText(text).last()

/** The one region every stage transition is announced through */
const liveRegion = (page: Page) => page.locator('.sr-only[role="status"]')

/** How long a stage is held open, so the state before it commits is observable */
const STAGE_DELAY_MS = 1500

const banFeature = (label: string, point: { lat: number; lng: number }) => ({
  properties: { label, context: 'France', type: 'municipality' },
  geometry: { coordinates: [point.lng, point.lat] },
})

/** The geocoder answers whichever of the two towns was typed */
function banResponse(query: string) {
  const q = query.toLowerCase()
  const place = q.includes('nantes') ? banFeature('Nantes', NANTES) : banFeature('Bordeaux', BORDEAUX)
  return { features: [place] }
}

function osrmRoute(distanceM: number) {
  return {
    code: 'Ok',
    routes: [
      {
        distance: distanceM,
        duration: 8400,
        geometry: {
          coordinates: [
            [TOULOUSE.lng, TOULOUSE.lat],
            [0.6, 44.2],
            [BORDEAUX.lng, BORDEAUX.lat],
          ],
        },
      },
    ],
  }
}

/** One priced station in the corridor, echoed near whatever point was queried */
function corridorStations(route: Route) {
  const where = new URL(route.request().url()).searchParams.get('where') ?? ''
  const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
  const lng = m ? parseFloat(m[1]) : TOULOUSE.lng
  const lat = m ? parseFloat(m[2]) : TOULOUSE.lat
  return {
    total_count: 1,
    results: [
      {
        id: `e2e-${lat.toFixed(2)}-${lng.toFixed(2)}`,
        ville: 'Testville',
        adresse: '1 rue du Test',
        geom: { lat, lon: lng },
        gazole_prix: '1.70',
      },
    ],
  }
}

interface StubOptions {
  /** 'ok' answers, 'down' aborts every attempt */
  routing?: 'ok' | 'down'
  corridor?: 'ok' | 'down'
  /** Holds the geometry stage open — that is when a stale result is on screen */
  routingDelayMs?: number
  /** Holds the corridor stage open — that is when the placeholders show */
  corridorDelayMs?: number
  distanceM?: number
}

async function stubSources(page: Page, opts: StubOptions = {}) {
  const {
    routing = 'ok',
    corridor = 'ok',
    routingDelayMs = 0,
    corridorDelayMs = 0,
    distanceM = 243_000,
  } = opts

  await page.route('**/brands-fra.json', (r) => r.fulfill({ json: { v: 1, labels: [], pois: [] } }))
  await page.route('**/proxy/ban/**', (r) =>
    r.fulfill({ json: banResponse(new URL(r.request().url()).searchParams.get('q') ?? '') }),
  )
  // Both engines the real provider can reach, so « down » really means down
  for (const engine of ['**/proxy/osrm/**', '**/proxy/valhalla/**']) {
    await page.route(engine, async (r) => {
      if (routing === 'down') return r.abort()
      if (routingDelayMs) await new Promise((res) => setTimeout(res, routingDelayMs))
      return r.fulfill({ json: osrmRoute(distanceM) })
    })
  }
  await page.route('**/proxy/fra/**', async (r) => {
    if (corridor === 'down') return r.abort()
    if (corridorDelayMs) await new Promise((res) => setTimeout(res, corridorDelayMs))
    return r.fulfill({ json: corridorStations(r) })
  })
}

/** Straight to the route form — these specs are about the ribbon, not the map */
async function submitRoute(page: Page, destination = 'Bordeaux') {
  await page.goto('/route')
  await pickDestination(page, destination)
}

/** Type a destination, take the suggestion, submit */
async function pickDestination(page: Page, destination: string) {
  await page.locator('input[placeholder="Destination"]').fill(destination)
  await page.getByText(destination, { exact: true }).first().click()
  await page.getByText('Comparer les stations sur le trajet').click()
}

test('the itinerary and its map show before a single station is known', async ({ page }) => {
  await stubSources(page, { corridorDelayMs: STAGE_DELAY_MS })
  await submitRoute(page)

  // Geometry stage: distance, duration and the corridor map are on screen while
  // the stop list is still only placeholders.
  await expect(page.getByText(/243 km ·/)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  await expect(page.locator('.skeleton').first()).toBeVisible()
  await expect(page.getByText('Arrêt conseillé')).toBeHidden()
  await expect(liveRegion(page)).toHaveText(/Itinéraire trouvé/)

  // Corridor stage: the placeholders give way to real stops, and the map and
  // header that were already there do not move.
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.skeleton')).toHaveCount(0)
  await expect(page.getByText(/243 km ·/)).toBeVisible()

  // Measured rather than eyeballed: the two commits are ordered and distinct.
  const timing = await page.evaluate(() =>
    Object.fromEntries(
      performance
        .getEntriesByType('measure')
        .filter((e) => e.name.startsWith('route:'))
        .map((e) => [e.name, e.duration]),
    ),
  )
  expect(timing['route:time-to-geometry']).toBeGreaterThan(0)
  expect(timing['route:time-to-stations']).toBeGreaterThan(timing['route:time-to-geometry'])
})

test('recomputing keeps the previous trip on screen, labelled', async ({ page }) => {
  await stubSources(page)
  await submitRoute(page)
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/243 km ·/)).toBeVisible()

  // Recompute another trip entirely: the previous one must stay drawn and say
  // so, instead of the ribbon blanking back to « Calcul de l'itinéraire… »
  await stubSources(page, { routingDelayMs: STAGE_DELAY_MS, distanceM: 465_000 })
  await page.getByText('Modifier').click()
  await pickDestination(page, 'Nantes')

  await expect(shown(page, /Trajet précédent/)).toBeVisible()
  // The stale distance keeps the destination it was computed for, never the
  // one being requested — « Toulouse → Nantes · 243 km » would be neither trip
  await expect(page.getByText(/243 km ·/)).toBeVisible()
  await expect(page.getByText(/Bordeaux/).first()).toBeVisible()
  await expect(page.getByText("Calcul de l'itinéraire…")).toBeHidden()

  // …until the new one replaces it, notice gone.
  await expect(page.getByText(/465 km ·/)).toBeVisible({ timeout: 30_000 })
  await expect(shown(page, /Trajet précédent/)).toBeHidden()
})

test('a corridor failure keeps the real itinerary and retries that stage alone', async ({
  page,
}) => {
  await stubSources(page, { corridor: 'down' })
  await submitRoute(page)

  // The geometry is real and stays; only the stations stage failed.
  await expect(page.getByText(/243 km ·/)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  await expect(shown(page, /Stations du trajet indisponibles/)).toBeVisible()
  await expect(liveRegion(page)).toHaveText(/Stations du trajet indisponibles/)
  // Never invented stops next to a real road
  await expect(page.getByText('Arrêt conseillé')).toBeHidden()

  // Retrying the stations does not recompute the itinerary underneath them
  await stubSources(page, { corridor: 'ok' })
  await page.getByRole('button', { name: 'Réessayer' }).last().click()
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/243 km ·/)).toBeVisible()
})

test('a routing failure is reported, never replaced by a fabricated line', async ({ page }) => {
  await stubSources(page, { routing: 'down' })
  await submitRoute(page)

  await expect(page.getByText('Itinéraire indisponible. Vérifiez votre connexion.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Arrêt conseillé')).toBeHidden()
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeHidden()

  // The retry re-runs the whole pipeline once the engine answers again
  await stubSources(page, { routing: 'ok' })
  await page.getByRole('button', { name: 'Réessayer' }).last().click()
  await expect(page.getByText(/243 km ·/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Arrêt conseillé')).toBeVisible({ timeout: 30_000 })
})
