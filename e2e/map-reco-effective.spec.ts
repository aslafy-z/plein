import { test, expect } from './fixtures'

// A cheaper pump farther away can cost as much as a closer one once the fuel
// burnt to reach it is counted (conso & réservoir des Réglages). The card
// crowns the best DEAL, not the best sticker price: 1,86 € at ~15.9 km vs
// 1,89 € at ~11.8 km (defaults: 6,5 L/100 km, 50 L) → effective 1,937 vs
// 1,948 €/L — within the 1-ct tie margin, and a tie goes to the NEAREST.

test.use({ seed: { sourceId: 'fra', onboarded: true, radius: 25 } })

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = [
      // ~15.9 km away — the sticker-cheapest
      {
        id: 'e2e-far-cheap',
        ville: 'Lointaine',
        adresse: '1 rue du Test',
        geom: { lat: lat + 0.143, lon: lng },
        gazole_prix: '1.860',
      },
      // ~11.8 km away, 3 ct dearer — the better deal once the détour is paid
      {
        id: 'e2e-near',
        ville: 'Proche',
        adresse: '2 rue du Test',
        geom: { lat: lat + 0.106, lon: lng },
        gazole_prix: '1.890',
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
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  // No road matrix → the crow-flies distances this spec's numbers are built on
  await page.route('**/proxy/osrm/**', (route) => route.abort())
  await page.goto('/')
})

test('a closer station wins when the détour eats the savings', async ({ page }) => {
  // The header owns up to it: this is the best choice, not the lowest price…
  await expect(page.getByText('Le meilleur choix près de vous')).toBeVisible({ timeout: 15_000 })
  // …and the card crowns the near 1,89 €, not the sticker-cheapest 1,86 €
  await expect(page.getByText('Station · Proche').first()).toBeVisible()
  await expect(page.getByText('1,89 €').first()).toBeVisible()

  // The list keeps the sticker-price order and its labels: the cheapest
  // first with « meilleur prix », the recommended one flagged as such
  await page.getByRole('button', { name: /liste des stations/ }).click()
  const rows = page.getByRole('button', { name: /^Voir / })
  await expect(rows.first()).toContainText('Lointaine')
  await expect(rows.first()).toContainText('meilleur prix')
  await expect(rows.nth(1)).toContainText('Proche')
  await expect(rows.nth(1)).toContainText('recommandée · +0,03')
})
