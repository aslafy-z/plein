import { test, expect, gotoMap } from './fixtures'

// The French feed carries tenths of a cent (1,896 vs 1,904) while the app
// displays cents — both read « 1,90 € ». The recommendation must not send
// the user 3 km farther for a difference they cannot see: at the same
// displayed cent, the NEAREST station wins.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = [
      // ~0.9 km away, 1,904 → displayed « 1,90 »
      {
        id: 'e2e-near',
        ville: 'Proche',
        adresse: '1 rue du Test',
        geom: { lat: lat + 0.008, lon: lng },
        gazole_prix: '1.904',
      },
      // ~3.3 km away, 1,896 → also displayed « 1,90 », sub-cent cheaper
      {
        id: 'e2e-far',
        ville: 'Lointaine',
        adresse: '2 rue du Test',
        geom: { lat: lat + 0.03, lon: lng },
        gazole_prix: '1.896',
      },
      // A pricier filler so the zone has a real spread
      {
        id: 'e2e-mid',
        ville: 'Fillerville',
        adresse: '3 rue du Test',
        geom: { lat: lat - 0.01, lon: lng },
        gazole_prix: '1.985',
      },
    ]
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  // No road matrix → the crow-flies distances this spec's numbers are built on
  await page.route('**/proxy/osrm/**', (route) => route.abort())
  await gotoMap(page)
})

test('at the same displayed price the nearest station is recommended', async ({ page }) => {
  // The card crowns the NEAREST of the two « 1,90 » stations…
  await expect(page.getByText('Station · Proche').first()).toBeVisible()
  await expect(page.getByText('1,90 €').first()).toBeVisible()
  // …not the sub-cent-cheaper one 3 km farther
  await expect(page.getByRole('button', { name: /Voir Station · Lointaine/ })).not.toContainText(
    'meilleur prix',
  )

  // …and the list keeps the sub-cent-cheaper one a bon plan without the
  // silly « +0,00 » delta
  await page.getByRole('button', { name: /liste des stations/ }).click()
  await expect(page.getByText('meilleur prix')).toHaveCount(1)
  const rows = page.getByRole('button', { name: /^Voir / })
  await expect(rows.first()).toContainText('Proche')
  await expect(rows.first()).toContainText('meilleur prix')
  await expect(rows.nth(1)).toContainText('Lointaine')
  await expect(rows.nth(1)).toContainText('bon plan')
  await expect(rows.nth(1)).not.toContainText('+0,00')
})
