import { test, expect, openZoneList } from './fixtures'

// Fuel outages (« ruptures ») come from the French flux only: a fuel in
// outage carries no price there, so without reading them the app said « not
// sold here » about a station that is merely dry. The records below use the
// live dataset's own column shapes (`*_rupture_type`, `*_rupture_debut`,
// Paris wall clocks labelled UTC). Layout-agnostic: runs on both projects.

test.use({ seed: { sourceId: 'fr', onboarded: true, fuel: 'diesel' } })

type Rec = Record<string, unknown>

async function mockFlux(page: import('@playwright/test').Page, records: (lat: number, lng: number) => Rec[]) {
  await page.route('**/proxy/fr/**', async (route) => {
    const url = new URL(route.request().url())
    const where = url.searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const all = records(lat, lng)
    // The fiche of a station off the loaded area asks by id
    const ids = /^id in \(([\d,]+)\)$/.exec(where)?.[1].split(',')
    const results = ids ? all.filter((r) => ids.includes(String(r.id))) : all
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fr.json', (route) => route.fulfill({ json: { v: 1, labels: [], pois: [] } }))
  await page.route('**/proxy/osrm/**', (route) => route.abort())
}

// A RECENT outage, so relative to the run: a station dry of everything for
// over a week is dormant and no longer counted as a shortage (`dormantSince`),
// which is what a fixed date turned these stations into a week after it was
// written. The flux's own shape is kept — a wall clock labelled UTC.
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 3600_000).toISOString().slice(0, 19) + '+00:00'

const dry = (id: string, ville: string, lat: number, lng: number, extra: Rec = {}): Rec => ({
  id,
  ville,
  adresse: '1 rue du Test',
  geom: { lat, lon: lng },
  gazole_rupture_type: 'temporaire',
  gazole_rupture_debut: TWO_DAYS_AGO,
  ...extra,
})

test('the fiche says a dry pump is out of stock, not « not sold here »', async ({ page }) => {
  await mockFlux(page, (lat, lng) => [
    // A fixed start, for the date the fiche prints — this one still sells
    // E85, so it never turns dormant however old the outage gets
    dry('31000020', 'Dryville', lat + 0.008, lng, {
      e85_prix: '0.899',
      gazole_rupture_debut: '2026-11-03T17:44:31+00:00',
    }),
    { id: '31000021', ville: 'Wetville', geom: { lat: lat - 0.01, lon: lng }, gazole_prix: '1.985' },
  ])
  await page.goto('/station/fr-31000020')

  await expect(page.getByText('Station · Dryville').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('out of stock since Nov 3')).toBeVisible()
  // E10 is neither priced nor in outage: still « not sold here »
  await expect(page.getByText('not sold here')).toBeVisible()
  // No diesel price, no fill-up to compare: the savings card stays out
  await expect(page.getByText(/on a \d+ L fill-up/)).toHaveCount(0)
})

test('a station out of everything for weeks reads as such on its fiche', async ({ page }) => {
  await mockFlux(page, (lat, lng) => [
    dry('31000030', 'Closedville', lat + 0.008, lng, {
      gazole_rupture_debut: '2026-09-18T16:45:17+00:00',
      e10_rupture_type: 'temporaire',
      e10_rupture_debut: '2026-09-17T11:58:40+00:00',
    }),
    { id: '31000031', ville: 'Wetville', geom: { lat: lat - 0.01, lon: lng }, gazole_prix: '1.985' },
  ])
  await page.goto('/station/fr-31000030')

  await expect(page.getByText('Station · Closedville').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('No fuel available since Sep 18.')).toBeVisible()
})

test('a zone whose diesel pumps are all dry names the shortage', async ({ page }) => {
  await mockFlux(page, (lat, lng) => [
    dry('31000040', 'Dryville', lat + 0.008, lng, { e85_prix: '0.899' }),
    dry('31000041', 'Dryhill', lat - 0.01, lng),
  ])
  await page.goto('/')

  await expect(page.getByText('Diesel: out of stock at 2 stations in this area.')).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByText('No station sells Diesel in this area.')).toHaveCount(0)
  // …and still offers what the zone does sell
  await expect(page.getByText('Sold here:')).toBeVisible()
  await expect(page.getByRole('button', { name: 'E85', exact: true })).toBeVisible()
})

test('the list counts the dry stations it leaves out', async ({ page }) => {
  await mockFlux(page, (lat, lng) => [
    dry('31000050', 'Dryville', lat + 0.008, lng),
    { id: '31000051', ville: 'Wetville', geom: { lat: lat - 0.01, lon: lng }, gazole_prix: '1.985' },
  ])
  await page.goto('/')
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })

  await openZoneList(page)
  await expect(page.getByTestId('zone-row')).toHaveCount(1)
  await expect(page.getByTestId('zone-outage-count')).toHaveText(
    'Diesel: out of stock at 1 station in this area.',
  )
})
