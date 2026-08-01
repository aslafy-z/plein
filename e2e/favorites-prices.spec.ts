import { test, expect, seedStationsCache } from './fixtures'

// Issue #133: a favorite keeps its price outside the loaded zone. One favorite
// sits in the live demo area (Toulouse), the other in a Paris area that only
// exists in the durable station cache — the Favoris tab must show both prices
// side by side, without visiting either zone, and without any network fetch
// (the seeded price is fresh, so the bounded refresh has nothing to do).

const PARIS = { lat: 48.8566, lng: 2.3522 }

const parisStation = {
  id: 'fra-remote1',
  name: 'Station · Paris',
  init: 'PA',
  lat: PARIS.lat,
  lng: PARIS.lng,
  address: '1 rue de Rivoli',
  city: 'Paris',
  prices: { diesel: { value: 1.612, updatedAt: new Date(Date.now() - 3_600_000).toISOString() } },
  tags: [],
  services: [],
  highway: false,
}

test.use({
  seed: {
    sourceId: 'demo',
    onboarded: true,
    favorites: [
      // 'su' is the demo dataset's Station U (diesel 1.67) — in the live area
      { id: 'su', name: 'Station U · Croix-Blanche', init: 'SU', lat: 43.6101, lng: 1.4519 },
      { id: 'fra-remote1', name: 'Station · Paris', init: 'PA', lat: PARIS.lat, lng: PARIS.lng },
    ],
  },
})

test('favorites in two areas show both prices at once', async ({ page }) => {
  await seedStationsCache(page, [
    {
      source: 'fra',
      center: PARIS,
      fetchRadiusKm: 25,
      ageMs: 60_000,
      stations: [parisStation],
    },
  ])

  await page.goto('/favorites')

  // The live demo price and the cached out-of-zone price, side by side
  await expect(page.getByText('1,67 €')).toBeVisible()
  await expect(page.getByText('1,61 €')).toBeVisible()
  // The out-of-zone row voices the age of its price instead of a dash
  const parisRow = page.getByRole('button', { name: 'Voir Station · Paris sur la carte' })
  await expect(parisRow).toContainText(/MàJ/)
  await expect(parisRow).not.toContainText('—')
})
