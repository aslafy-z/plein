import { test, expect } from './fixtures'

// Distances shown (and fed into the effective-price ranking) come from a real
// road matrix (OSRM /table), not crow-flies. Two stations north of the user:
// « Rivegauche » looks close as the crow flies (~2,2 km) and has the best
// sticker price, but the only bridge makes it 12 km by road; « Rivedroite »
// is 3,5 km by road. Defaults (6,5 L/100 km, 50 L):
//   effective Rivegauche 1,850 × (1 + 24×6,5/100/50)  ≈ 1,908 €/L
//   effective Rivedroite 1,870 × (1 +  7×6,5/100/50)  ≈ 1,887 €/L
// → the road-aware reco is Rivedroite, 2 ct beyond the 1-ct tie margin.
// When the matrix is unreachable, crow-flies takes over and Rivegauche wins.

test.use({ seed: { sourceId: 'fra', onboarded: true, radius: 25 } })

function stubStations(page: import('@playwright/test').Page) {
  return page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = [
      // ~2,2 km crow-flies, sticker-cheapest — but 12 km by road
      {
        id: 'e2e-bridge',
        ville: 'Rivegauche',
        adresse: '1 rue du Test',
        geom: { lat: lat + 0.02, lon: lng },
        gazole_prix: '1.850',
      },
      // ~3,3 km crow-flies, 2 ct dearer — 3,5 km by road
      {
        id: 'e2e-direct',
        ville: 'Rivedroite',
        adresse: '2 rue du Test',
        geom: { lat: lat + 0.03, lon: lng },
        gazole_prix: '1.870',
      },
      // A pricier filler so the zone has a real spread
      {
        id: 'e2e-mid',
        ville: 'Fillerville',
        adresse: '3 rue du Test',
        geom: { lat: lat - 0.01, lon: lng },
        gazole_prix: '1.990',
      },
    ]
    await route.fulfill({ json: { total_count: results.length, results } })
  })
}

test.beforeEach(async ({ page }) => {
  await stubStations(page)
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
})

test('the reco and distances follow the road matrix, not crow-flies', async ({ page }) => {
  await page.route('**/proxy/osrm/table/**', (route) => {
    // Row 0 = from the origin to [origin, …targets]; targets are requested
    // nearest-crow-flies first: Fillerville (~1,1 km), Rivegauche, Rivedroite
    void route.fulfill({
      json: {
        code: 'Ok',
        durations: [[0, 240, 900, 360]],
        distances: [[0, 2000, 12000, 3500]],
      },
    })
  })
  await page.goto('/')

  // The card crowns Rivedroite — dearer at the pump, far cheaper to reach —
  // with its road distance and matrix drive time, not ~3,3 km / ~7 min
  await expect(page.getByText('Le meilleur choix près de vous')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Station · Rivedroite').first()).toBeVisible()
  await expect(page.getByText('3,5 km').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Y aller · 6 min/ })).toBeVisible()

  // The list keeps sticker order: crow-flies-close Rivegauche stays the
  // « meilleur prix » but shows its real 12 km; Rivedroite is recommended
  await page.getByRole('button', { name: /liste des stations/ }).click()
  const rows = page.getByRole('button', { name: /^Voir / })
  await expect(rows.first()).toContainText('Rivegauche')
  await expect(rows.first()).toContainText('meilleur prix')
  await expect(rows.first()).toContainText('12,0 km')
  await expect(rows.nth(1)).toContainText('Rivedroite')
  await expect(rows.nth(1)).toContainText('recommandée · +0,02')
})

test('crow-flies fallback when the road matrix is unreachable', async ({ page }) => {
  await page.route('**/proxy/osrm/**', (route) => route.abort())
  await page.goto('/')

  // Without road knowledge Rivegauche is closest AND sticker-cheapest
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Station · Rivegauche').first()).toBeVisible()
  await expect(page.getByText('2,2 km').first()).toBeVisible()
})
