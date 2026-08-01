import { test, expect, openRouteSheet, closeRouteSheet, pickRoutePlace } from './fixtures'
import type { Page, Route as PwRoute } from '@playwright/test'

// The route is computed in two stages and committed twice: the itinerary as
// soon as the routing engine answers, the corridor stations after. These specs
// pin the consequences — the trip is readable before any station is known, a
// recompute never blanks what is on screen, and a stage that fails is reported
// where it failed instead of being papered over.
//
// Every endpoint is stubbed, and the window between the two stages is held
// open by the test itself (a promise the stub awaits), so what the screen
// shows between the commits is observable without racing a timer.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

const TOULOUSE = { lat: 43.6045, lng: 1.4442 }
const BORDEAUX = { lat: 44.8378, lng: -0.5792 }
const NANTES = { lat: 47.2184, lng: -1.5536 }

/** The one region every stage transition is announced through */
const liveRegion = (page: Page) => page.locator('.sr-only[role="status"]')

const banFeature = (label: string, point: { lat: number; lng: number }) => ({
  properties: { label, context: 'France', type: 'municipality' },
  geometry: { coordinates: [point.lng, point.lat] },
})

/** The geocoder answers whichever of the two towns was typed */
function banResponse(query: string) {
  const q = query.toLowerCase()
  const place = q.includes('nantes')
    ? banFeature('Nantes', NANTES)
    : banFeature('Bordeaux', BORDEAUX)
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
function corridorStations(route: PwRoute) {
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

/** Brand enrichment, the geocoder, and an instantly-empty boot zone — the
    zone must answer so the fallback banner (and its own « Réessayer ») stays
    out of these specs' way. */
async function stubStatics(page: Page) {
  await page.route('**/brands-fra.json', (r) =>
    r.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/ban/**', (r) =>
    r.fulfill({ json: banResponse(new URL(r.request().url()).searchParams.get('q') ?? '') }),
  )
  await page.route('**/proxy/fra/**', (r) => r.fulfill({ json: { total_count: 0, results: [] } }))
}

interface StageStub {
  /** Lets a held stage answer; a no-op for 'ok' and 'down' modes */
  release(): void
}

/** Both engines the real provider can reach, so « down » really means down */
async function stubRouting(
  page: Page,
  { mode = 'ok', distanceM = 243_000 }: { mode?: 'ok' | 'down' | 'hold'; distanceM?: number } = {},
): Promise<StageStub> {
  let release!: () => void
  const held = new Promise<void>((res) => (release = res))
  for (const engine of ['**/proxy/osrm/**', '**/proxy/valhalla/**']) {
    await page.route(engine, async (r) => {
      if (mode === 'down') return r.abort()
      if (mode === 'hold') await held
      return r.fulfill({ json: osrmRoute(distanceM) })
    })
  }
  return { release }
}

/** Registered after stubStatics, so it takes over the corridor queries */
async function stubCorridor(
  page: Page,
  { mode = 'ok' }: { mode?: 'ok' | 'down' | 'hold' } = {},
): Promise<StageStub> {
  let release!: () => void
  const held = new Promise<void>((res) => (release = res))
  await page.route('**/proxy/fra/**', async (r) => {
    if (mode === 'down') return r.abort()
    if (mode === 'hold') await held
    return r.fulfill({ json: corridorStations(r) })
  })
  return { release }
}

/** Straight to the route screen — these specs are about the pipeline, not the map */
async function gotoRoute(page: Page) {
  await page.goto('/')
  await page.getByText('Trajet', { exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Comparer les stations sur le trajet' }),
  ).toBeVisible()
}

/** Pick a destination through the shared search field, then submit */
async function submitTrip(page: Page, destination: string) {
  await pickRoutePlace(page, 'to', destination, destination)
  await page.getByRole('button', { name: 'Comparer les stations sur le trajet' }).click()
}

test('the itinerary and its map show before a single station is known', async ({ page }) => {
  await stubStatics(page)
  await stubRouting(page)
  await gotoRoute(page)
  const corridor = await stubCorridor(page, { mode: 'hold' })
  await submitTrip(page, 'Bordeaux')

  // Geometry stage: distance, duration and the corridor map are on screen
  // while the stop list is still only placeholders.
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  await openRouteSheet(page)
  await expect(page.locator('.skeleton').first()).toBeVisible()
  await expect(page.getByText('Arrêt conseillé').first()).toBeHidden()
  await expect(liveRegion(page)).toHaveText(/Itinéraire trouvé/)

  // Corridor stage: the placeholders give way to real stops, and the header
  // that was already there does not move.
  corridor.release()
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.skeleton')).toHaveCount(0)
  await expect(page.getByText(/243 km ·/).first()).toBeVisible()

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

test('a cold computation shows the trip it is waiting for, not a bare sentence', async ({
  page,
}) => {
  await stubStatics(page)
  const routing = await stubRouting(page, { mode: 'hold' })
  await gotoRoute(page)
  await stubCorridor(page)
  await submitTrip(page, 'Bordeaux')

  // No geometry yet — but the endpoints are the user's own input, so the wait
  // is the timeline it is turning into rather than « Calcul de l'itinéraire… »
  await openRouteSheet(page)
  await expect(page.locator('.skeleton').first()).toBeVisible()
  await expect(page.getByText('Départ · Ma position')).toBeVisible()
  await expect(page.getByText('Arrivée · Bordeaux')).toBeVisible()
  await expect(page.getByText(/243 km ·/).first()).toBeHidden()
  // the sentence is still announced — through the live region, and only there
  await expect(page.getByText("Calcul de l'itinéraire…")).toHaveCount(1)
  await expect(liveRegion(page)).toHaveText("Calcul de l'itinéraire…")

  routing.release()
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
})

test('recomputing keeps the previous trip on screen, labelled', async ({ page }) => {
  await stubStatics(page)
  await stubRouting(page)
  await gotoRoute(page)
  await stubCorridor(page)
  await submitTrip(page, 'Bordeaux')
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })

  // Recompute another trip entirely, holding the new geometry open: the
  // previous one must stay drawn and say so, instead of the panel blanking
  // back to « Calcul de l'itinéraire… »
  const routing2 = await stubRouting(page, { mode: 'hold', distanceM: 465_000 })
  await openRouteSheet(page)
  await page.getByText('Modifier', { exact: true }).click()
  await closeRouteSheet(page)
  await pickRoutePlace(page, 'to', 'Nantes', 'Nantes')
  await page.getByRole('button', { name: 'Comparer les stations sur le trajet' }).click()

  await openRouteSheet(page)
  await expect(page.getByText(/Trajet précédent/).first()).toBeVisible()
  // The stale distance keeps the destination it was computed for, never the
  // one being requested — « Ma position → Nantes · 243 km » would be neither trip
  await expect(page.getByText(/243 km ·/).first()).toBeVisible()
  await expect(page.getByText('Ma position → Bordeaux').first()).toBeVisible()
  await expect(page.getByText("Calcul de l'itinéraire…")).toHaveCount(0)

  // …until the new one replaces it, notice gone.
  routing2.release()
  await expect(page.getByText(/465 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Trajet précédent/)).toHaveCount(0)
  await expect(page.getByText('Ma position → Nantes').first()).toBeVisible()
})

test('a corridor failure keeps the real itinerary and retries that stage alone', async ({
  page,
}) => {
  await stubStatics(page)
  await stubRouting(page)
  let engineRequests = 0
  page.on('request', (req) => {
    if (/\/proxy\/(osrm|valhalla)\//.test(req.url())) engineRequests++
  })
  await gotoRoute(page)
  await stubCorridor(page, { mode: 'down' })
  await submitTrip(page, 'Bordeaux')

  // The geometry is real and stays; only the stations stage failed.
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Carte du trajet"]')).toBeVisible()
  await openRouteSheet(page)
  await expect(page.getByText(/Stations du trajet indisponibles/).last()).toBeVisible()
  // Never invented stops next to a real road
  await expect(page.getByText('Arrêt conseillé').first()).toBeHidden()

  // Retrying the stations does not recompute the itinerary underneath them
  const enginesBefore = engineRequests
  await stubCorridor(page)
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/243 km ·/).first()).toBeVisible()
  expect(engineRequests).toBe(enginesBefore)
})

test('a routing failure is reported, never replaced by a fabricated line', async ({ page }) => {
  await stubStatics(page)
  await stubRouting(page, { mode: 'down' })
  await gotoRoute(page)
  await stubCorridor(page)
  await submitTrip(page, 'Bordeaux')

  await expect(
    page.getByText('Itinéraire indisponible. Vérifiez votre connexion.').first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Arrêt conseillé').first()).toBeHidden()
  await expect(page.getByText(/243 km ·/).first()).toBeHidden()

  // The retry re-runs the whole pipeline once the engine answers again
  await stubRouting(page)
  await openRouteSheet(page)
  await page.getByRole('button', { name: 'Réessayer' }).click()
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Arrêt conseillé').first()).toBeVisible({ timeout: 30_000 })
})
