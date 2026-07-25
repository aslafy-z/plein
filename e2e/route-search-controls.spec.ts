import { test, expect, gotoMap } from './fixtures'

// The route setup fields behave like the map's place search: a spinner from the
// first keystroke until the geocoder answers, and a ✕ that empties the field.
// « Ma position » is a value the departure carries, so its ✕ frees the field
// for typing — an empty departure still means « wherever I am ».

test.use({
  seed: { sourceId: 'fra', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

test('the route fields show the search in progress and clear themselves', async ({ page }) => {
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

  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()

  const spinner = page.getByRole('status', { name: 'Recherche en cours…' })
  const departure = page.locator('input[placeholder="Départ"]')
  const destination = page.locator('input[placeholder="Destination"]')
  const clearDestination = page.getByRole('button', { name: 'Effacer la destination' })
  const clearDeparture = page.getByRole('button', { name: 'Effacer le départ' })

  await expect(spinner).toBeHidden()
  await expect(clearDestination).toBeHidden()
  // « Ma position » is a value the field carries, so it has its ✕ right away
  await expect(departure).toHaveValue('Ma position')
  await expect(clearDeparture).toBeVisible()

  // ── Destination: spinner while the geocoder answers, then the ✕ ──
  await destination.fill('Bordeaux')
  await expect(spinner).toBeVisible()
  await expect(clearDestination).toBeVisible()

  await expect(page.getByText('Bordeaux centre')).toBeVisible({ timeout: 10_000 })
  await expect(spinner).toBeHidden()

  await clearDestination.click()
  await expect(destination).toHaveValue('')
  await expect(clearDestination).toBeHidden()
  // Clearing drops the pending search with the suggestions
  await expect(page.getByText('Bordeaux centre')).toBeHidden()

  // ── Departure: its ✕ frees the field for typing ──
  await clearDeparture.click()
  await expect(departure).toHaveValue('')
  await expect(clearDeparture).toBeHidden()

  await departure.fill('Bordeaux')
  await expect(clearDeparture).toBeVisible()

  // Emptied by hand, the field stays empty under the cursor…
  await departure.fill('')
  await expect(departure).toHaveValue('')
  // …and says « Ma position » again once it loses the focus, which is where
  // the route really departs from.
  await destination.click()
  await expect(departure).toHaveValue('Ma position')
})
