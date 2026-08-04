import { test, expect, openRouteSheet, closeRouteSheet, pickRoutePlace } from './fixtures'
import type { Page, Route as PwRoute } from '@playwright/test'

// The route is computed in three stages: the itinerary as soon as the routing
// engine answers, the corridor stations after, then the road matrix the
// fuel-stop plan runs on. These specs pin the consequences — the trip is
// readable before any station is known, a recompute never blanks what is on
// screen, and a stage that fails is reported where it failed instead of being
// papered over.
//
// Every endpoint is stubbed, and the window between the two stages is held
// open by the test itself (a promise the stub awaits), so what the screen
// shows between the commits is observable without racing a timer.

test.use({ seed: { sourceId: 'fr', onboarded: true } })

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

/** Rough km between two coordinates — enough for a synthetic matrix cell */
function crowKm(a: [number, number], b: [number, number]) {
  const dLat = (a[1] - b[1]) * 111
  const dLng = (a[0] - b[0]) * 111 * Math.cos((a[1] * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

/** Answer the plan's square-matrix call with distances derived from the
    requested coordinates — deterministic, and shaped like the real thing. */
async function stubTravelMatrix(page: Page) {
  await page.route('**/proxy/osrm/table/**', (r) => {
    const path = new URL(r.request().url()).pathname
    const coords = path
      .slice(path.lastIndexOf('/') + 1)
      .split(';')
      .map((c) => c.split(',').map(parseFloat) as [number, number])
    const distances = coords.map((a) => coords.map((b) => crowKm(a, b) * 1.25 * 1000))
    const durations = distances.map((row) => row.map((m) => (m / 1000 / 80) * 3600))
    return r.fulfill({ json: { code: 'Ok', distances, durations } })
  })
}

/** Brand enrichment, the geocoder, the plan matrix and an instantly-empty
    boot zone — the zone must answer so the fallback banner (and its own
    « Retry ») stays out of these specs' way. */
async function stubStatics(page: Page) {
  await page.route('**/brands-fr.json', (r) =>
    r.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/ban/**', (r) =>
    r.fulfill({ json: banResponse(new URL(r.request().url()).searchParams.get('q') ?? '') }),
  )
  await stubTravelMatrix(page)
  await page.route('**/proxy/fr/**', (r) => r.fulfill({ json: { total_count: 0, results: [] } }))
}

interface StageStub {
  /** Lets a held stage answer; a no-op for 'ok' and 'down' modes */
  release(): void
}

/** Both engines the real provider can reach, so « down » really means down.
    Route endpoints only: the plan's matrix call (table / sources_to_targets)
    is its own stage with its own stub. */
async function stubRouting(
  page: Page,
  { mode = 'ok', distanceM = 243_000 }: { mode?: 'ok' | 'down' | 'hold'; distanceM?: number } = {},
): Promise<StageStub> {
  let release!: () => void
  const held = new Promise<void>((res) => (release = res))
  for (const engine of ['**/proxy/osrm/route/**', '**/proxy/valhalla/route**']) {
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
  await page.route('**/proxy/fr/**', async (r) => {
    if (mode === 'down') return r.abort()
    if (mode === 'hold') await held
    return r.fulfill({ json: corridorStations(r) })
  })
  return { release }
}

/** Straight to the route screen — these specs are about the pipeline, not the map */
async function gotoRoute(page: Page) {
  await page.goto('/')
  await page.getByText('Route', { exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Compare the stations along the route' }),
  ).toBeVisible()
}

/** Pick a destination through the shared search field — picking submits */
async function submitTrip(page: Page, destination: string) {
  await pickRoutePlace(page, 'to', destination, destination)
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
  await expect(page.locator('[aria-label="Map of the route"]')).toBeVisible()
  await openRouteSheet(page)
  await expect(page.locator('.skeleton').first()).toBeVisible()
  await expect(page.getByText('No fuel stop needed')).toHaveCount(0)
  await expect(liveRegion(page)).toHaveText(/Route found/)

  // Corridor stage: the placeholders give way to the plan (the stubbed tank
  // covers the stubbed trip, so it is the zero-stop card), and the header
  // that was already there does not move.
  corridor.release()
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('.skeleton')).toHaveCount(0)
  await expect(page.getByText(/243 km ·/).first()).toBeVisible()

  // Matrix stage: the plan's legs upgrade from the geometric estimate to the
  // (stubbed) road matrix — measurable, like the other two commits.
  await page.waitForFunction(
    () => performance.getEntriesByType('measure').some((e) => e.name === 'route:time-to-plan'),
    undefined,
    { timeout: 30_000 },
  )

  // Measured rather than eyeballed: the three commits are ordered and distinct.
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
  expect(timing['route:time-to-plan']).toBeGreaterThan(timing['route:time-to-stations'])
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
  // is the timeline it is turning into rather than « Working out the route… »
  await openRouteSheet(page)
  await expect(page.locator('.skeleton').first()).toBeVisible()
  await expect(page.getByText('From · My position')).toBeVisible()
  await expect(page.getByText('Arrival · Bordeaux')).toBeVisible()
  await expect(page.getByText(/243 km ·/).first()).toBeHidden()
  // the sentence is still announced — through the live region, and only there
  await expect(page.getByText('Working out the route…')).toHaveCount(1)
  await expect(liveRegion(page)).toHaveText('Working out the route…')

  routing.release()
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
})

test('recomputing keeps the previous trip on screen, labelled', async ({ page }) => {
  await stubStatics(page)
  await stubRouting(page)
  await gotoRoute(page)
  await stubCorridor(page)
  await submitTrip(page, 'Bordeaux')
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })

  // Recompute another trip entirely, holding the new geometry open: the
  // previous one must stay drawn and say so, instead of the panel blanking
  // back to « Working out the route… »
  const routing2 = await stubRouting(page, { mode: 'hold', distanceM: 465_000 })
  await openRouteSheet(page)
  await page.getByText('Edit', { exact: true }).click()
  await closeRouteSheet(page)
  // Picking the new destination starts the recompute on its own
  await pickRoutePlace(page, 'to', 'Nantes', 'Nantes')

  await openRouteSheet(page)
  await expect(page.getByText(/Previous trip/).first()).toBeVisible()
  // The stale distance keeps the destination it was computed for, never the
  // one being requested — « My position → Nantes · 243 km » would be neither trip
  await expect(page.getByText(/243 km ·/).first()).toBeVisible()
  await expect(page.getByText('My position → Bordeaux').first()).toBeVisible()
  await expect(page.getByText('Working out the route…')).toHaveCount(0)

  // …until the new one replaces it, notice gone.
  routing2.release()
  await expect(page.getByText(/465 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Previous trip/)).toHaveCount(0)
  await expect(page.getByText('My position → Nantes').first()).toBeVisible()
})

test('a corridor failure keeps the real itinerary and retries that stage alone', async ({
  page,
}) => {
  await stubStatics(page)
  await stubRouting(page)
  let engineRequests = 0
  page.on('request', (req) => {
    // Route computations only — the plan's matrix calls are their own stage
    // and legitimately fire once the corridor finally lands
    if (/\/proxy\/(osrm\/route|valhalla\/route)/.test(req.url())) engineRequests++
  })
  await gotoRoute(page)
  await stubCorridor(page, { mode: 'down' })
  await submitTrip(page, 'Bordeaux')

  // The geometry is real and stays; only the stations stage failed.
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[aria-label="Map of the route"]')).toBeVisible()
  await openRouteSheet(page)
  await expect(page.getByText(/Stations along the route are unavailable/).last()).toBeVisible()
  // Never invented stops (or a plan over them) next to a real road
  await expect(page.getByText('No fuel stop needed')).toHaveCount(0)

  // Retrying the stations does not recompute the itinerary underneath them
  const enginesBefore = engineRequests
  await stubCorridor(page)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
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
    page.getByText('Route unavailable. Check your connection.').first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('No fuel stop needed')).toHaveCount(0)
  await expect(page.getByText(/243 km ·/).first()).toBeHidden()

  // The retry re-runs the whole pipeline once the engine answers again
  await stubRouting(page)
  await openRouteSheet(page)
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText(/243 km ·/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
})
