import { test, expect } from './fixtures'

// French station ids carry a `fra-` prefix, like `esp-`/`and-`, so the mixed
// « Automatic » list stays attributable. Links and favorites created before
// that prefix hold a bare id — both must keep working.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

test.beforeEach(async ({ page }) => {
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = [
      {
        id: '31000009',
        ville: 'Prefixville',
        adresse: '1 rue du Test',
        geom: { lat: lat + 0.008, lon: lng },
        gazole_prix: '1.904',
      },
      {
        id: '31000010',
        ville: 'Fillerville',
        adresse: '2 rue du Test',
        geom: { lat: lat - 0.01, lon: lng },
        gazole_prix: '1.985',
      },
    ]
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/osrm/**', (route) => route.abort())
})

test('a French station is reachable under its prefixed id', async ({ page }) => {
  await page.goto('/station/fra-31000009')

  await expect(page.getByText('Station · Prefixville').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('source: prix-carburants.gouv.fr')).toBeVisible()
})

test('a link made before the prefix still opens the fiche', async ({ page }) => {
  await page.goto('/station/31000009')

  await expect(page.getByText('Station · Prefixville').first()).toBeVisible({ timeout: 15_000 })
})

test('a favorite pinned before the prefix is still recognised', async ({ page }) => {
  await page.goto('/station/fra-31000009')
  await expect(page.getByText('Station · Prefixville').first()).toBeVisible({ timeout: 15_000 })
  // Nothing migrated yet: the star reflects an empty favorites list
  await expect(page.getByRole('button', { name: 'Add to favorites' })).toBeVisible()

  // Re-seed with a favorite holding the OLD, bare id and reload
  await page.evaluate(() => {
    const raw = localStorage.getItem('plein.settings.v1')
    const settings = raw ? JSON.parse(raw) : {}
    settings.favorites = [
      { id: '31000009', name: 'Station · Prefixville', init: 'PR', city: 'Prefixville', lat: 43.6, lng: 1.44 },
    ]
    localStorage.setItem('plein.settings.v1', JSON.stringify(settings))
  })
  await page.reload()

  await expect(page.getByText('Station · Prefixville').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible()
})
