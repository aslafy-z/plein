import { test, expect, gotoMap, desktopOnly, phoneOnly } from './fixtures'

// The route's departure and arrival fields ARE the map's place search
// (PlaceField): same debounce, same spinner, same ✕, same containers. This
// covers the route-specific policy on top of it — « Ma position » as a value
// the departure carries, and the phone's full-screen search naming the field
// it fills. The shared close/ring/dropdown behaviour is search-close.spec.ts.

test.use({
  seed: { sourceId: 'fra', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', (route) =>
    route.fulfill({
      json: {
        total_count: 1,
        results: [
          {
            id: 'e2e-1',
            ville: 'Toulouse',
            adresse: '1 rue du Test',
            geom: { lat: 43.606, lon: 1.446 },
            gazole_prix: '1.70',
          },
        ],
      },
    }),
  )
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  // A geocoder that takes its time — long enough for the spinner to be observable
  await page.route('**/proxy/ban/**', async (route) => {
    await new Promise((r) => setTimeout(r, 1_500))
    await route
      .fulfill({
        json: {
          type: 'FeatureCollection',
          features: [
            {
              geometry: { coordinates: [-0.5792, 44.8378] },
              properties: { label: 'Bordeaux centre', context: '33, Gironde, Nouvelle-Aquitaine' },
            },
          ],
        },
      })
      .catch(() => {})
  })
})

test.describe('window', () => {
  desktopOnly('the inline fields with an attached dropdown are the desktop arrangement')

  test('the route fields show the search in progress and clear themselves', async ({ page }) => {
    await gotoMap(page)
    await page.getByText('Trajet', { exact: true }).click()

    const spinner = page.getByRole('status', { name: 'Recherche en cours…' })
    const departure = page.getByPlaceholder('Départ')
    const destination = page.getByPlaceholder('Destination')
    const clearDestination = page.getByRole('button', { name: 'Effacer la destination' })

    await expect(spinner).toBeHidden()
    await expect(clearDestination).toBeHidden()
    // « Ma position » is a value the departure field carries
    await expect(departure).toHaveValue('Ma position')

    // ── Destination: spinner while the geocoder answers, then the ✕ ──
    await destination.fill('Bordeaux')
    await expect(spinner).toBeVisible()
    await expect(clearDestination).toBeVisible()

    await expect(page.getByText('Bordeaux centre')).toBeVisible({ timeout: 10_000 })
    await expect(spinner).toBeHidden()

    await clearDestination.click()
    await expect(destination).toHaveValue('')
    // Clearing drops the pending search with the suggestions
    await expect(page.getByText('Bordeaux centre')).toBeHidden()

    // ── Departure: it edits as EMPTY (« Ma position » is not text to fix),
    // and an empty field means « wherever I am » again once it settles ──
    await departure.click()
    await expect(departure).toHaveValue('')
    await departure.fill('Bordeaux')
    const clearDeparture = page.getByRole('button', { name: 'Effacer le départ' })
    await expect(clearDeparture).toBeVisible()
    await clearDeparture.click()
    await expect(departure).toHaveValue('')

    await destination.click()
    await expect(departure).toHaveValue('Ma position')
  })
})

test.describe('phone', () => {
  phoneOnly('the full-screen search opening from the field is the phone arrangement')

  test('a field opens the shared full-screen search, named after the field', async ({ page }) => {
    await gotoMap(page)
    await page.getByText('Trajet', { exact: true }).click()

    // The two triggers float over the map
    await expect(page.getByRole('button', { name: 'Départ', exact: true })).toContainText(
      'Ma position',
    )
    await page.getByRole('button', { name: 'Destination', exact: true }).click()

    // The same portalled panel as the map's search — with the field's name
    const panel = page.getByTestId('search-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Destination', { exact: true })).toBeVisible()

    const input = page.getByPlaceholder('Destination')
    await expect(input).toBeFocused()
    await input.fill('Bordeaux')
    await expect(page.getByRole('status', { name: 'Recherche en cours…' })).toBeVisible()
    await expect(page.getByText('Bordeaux centre')).toBeVisible({ timeout: 10_000 })

    // The system Back closes the search onto the route stage, not the app
    await page.goBack()
    await expect(panel).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Comparer les stations sur le trajet' }),
    ).toBeVisible()
  })

  test('picking a place fills the field it was opened for', async ({ page }) => {
    await gotoMap(page)
    await page.getByText('Trajet', { exact: true }).click()

    await page.getByRole('button', { name: 'Destination', exact: true }).click()
    await page.getByPlaceholder('Destination').fill('Bordeaux')
    await page
      .getByTestId('search-suggestions')
      .getByText('Bordeaux centre')
      .click({ timeout: 10_000 })

    await expect(page.getByTestId('search-panel')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Destination', exact: true })).toContainText(
      'Bordeaux centre',
    )
    // The departure was untouched
    await expect(page.getByRole('button', { name: 'Départ', exact: true })).toContainText(
      'Ma position',
    )
  })
})
