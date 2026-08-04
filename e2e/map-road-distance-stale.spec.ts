import { test, expect } from './fixtures'

// Road distances are measured from the user's position. When the user moves
// far from the loaded stations, none of them is worth a routing call any more
// — and the numbers measured from the position they left must go with it,
// otherwise the app keeps showing distances from a place the user has quit.
// « Rivegauche » is a favorite: 2.2 km of straight line from Toulouse, 12 km
// by road. Once the user is in Lyon it must read as the ~466 km estimate
// (358 km of straight line × 1.3), never again as 12.0 km.

const TOULOUSE = { lat: 43.6047, lng: 1.4442 }
const LYON = { lat: 45.764, lng: 4.8357 }
const BRIDGE = { lat: 43.6247, lng: 1.4442 }

test.use({
  seed: {
    sourceId: 'fra',
    onboarded: true,
    geoGranted: true,
    radius: 25,
    lastPos: TOULOUSE,
    favorites: [
      {
        id: 'fra-e2e-bridge',
        name: 'Rivegauche',
        init: 'RI',
        city: 'Rivegauche',
        lat: BRIDGE.lat,
        lng: BRIDGE.lng,
      },
    ],
  },
})

/** The position the mocked device reports on the next fix */
declare global {
  interface Window {
    __pos: { lat: number; lng: number }
  }
}

test.beforeEach(async ({ page }) => {
  // Own geolocation mock: the app asks for a fix with `maximumAge: 5 min`, and
  // the emulated device replays the first one for that long — this test needs
  // the user to actually move between two fixes, inside the same document.
  await page.addInitScript((start) => {
    window.__pos = start
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          setTimeout(
            () =>
              ok({
                coords: { latitude: window.__pos.lat, longitude: window.__pos.lng, accuracy: 12 },
                timestamp: Date.now(),
              } as GeolocationPosition),
            0,
          ),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    })
  }, TOULOUSE)
  // Fixed coordinates, whatever area is asked for: the same stations stay
  // loaded when the user jumps to Lyon, which is what leaves them all outside
  // the routing radius while their ids still carry road measurements.
  await page.route('**/proxy/fra/**', (route) =>
    route.fulfill({
      json: {
        total_count: 3,
        results: [
          {
            id: 'e2e-bridge',
            ville: 'Rivegauche',
            adresse: '1 rue du Test',
            geom: { lat: BRIDGE.lat, lon: BRIDGE.lng },
            gazole_prix: '1.850',
          },
          {
            id: 'e2e-direct',
            ville: 'Rivedroite',
            adresse: '2 rue du Test',
            geom: { lat: 43.6347, lon: 1.4442 },
            gazole_prix: '1.870',
          },
          {
            id: 'e2e-mid',
            ville: 'Fillerville',
            adresse: '3 rue du Test',
            geom: { lat: 43.5947, lon: 1.4442 },
            gazole_prix: '1.990',
          },
        ],
      },
    }),
  )
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  // Targets are requested nearest-crow-flies first: Fillerville, Rivegauche,
  // Rivedroite. Only ever called while the user is in Toulouse.
  await page.route('**/proxy/osrm/table/**', (route) =>
    route.fulfill({
      json: { code: 'Ok', durations: [[0, 240, 900, 360]], distances: [[0, 2000, 12000, 3500]] },
    }),
  )
})

test('moving away from the measured area drops its road distances', async ({ page }) => {
  await page.goto('/')
  // The matrix landed — the reco follows road distances, not crow-flies
  await expect(page.getByText('The best choice near you')).toBeVisible({ timeout: 15_000 })

  const favRow = page.locator('button[aria-label="Show Rivegauche on the map"]')
  await page.getByText('Favorites', { exact: true }).click()
  await expect(favRow).toContainText('12.0 km')

  // The user is now 358 km away: nothing loaded is worth a routing call
  await page.getByText('Map', { exact: true }).click()
  await page.evaluate((pos) => {
    window.__pos = pos
  }, LYON)
  await page.getByRole('button', { name: 'Recentre on my position' }).click()

  // …so the favorite falls back to the crow-flies estimate from Lyon instead
  // of keeping the 12 km measured from Toulouse
  await page.getByText('Favorites', { exact: true }).click()
  await expect(favRow).toContainText('465.8 km')
})
