import { test, expect, gotoMap } from './fixtures'

// Dense zones: the pull-up list opens on the 15 cheapest stations only, with
// a « Afficher les N autres » button carrying the rest — the header still
// announces the full count, so nothing pretends the zone stops at 15.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

const TOTAL = 22
const CAP = 15

test.beforeEach(async ({ page }) => {
  // Deterministic gouv flux: TOTAL stations ringed around the queried center,
  // prices strictly increasing so the « cheapest » ordering is unambiguous.
  await page.route('**/proxy/gouv/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = Array.from({ length: TOTAL }, (_, i) => {
      const angle = (2 * Math.PI * i) / TOTAL
      return {
        id: `e2e-${i}`,
        ville: 'Testville',
        adresse: `${i} rue du Test`,
        geom: { lat: lat + 0.015 * Math.sin(angle), lon: lng + 0.02 * Math.cos(angle) },
        gazole_prix: (1.6 + i * 0.01).toFixed(2),
      }
    })
    await route.fulfill({ json: { total_count: TOTAL, results } })
  })
  // Brand enrichment is irrelevant here — keep it deterministic and instant
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await gotoMap(page)
})

test('a dense zone lists the 15 cheapest, the rest behind « Afficher »', async ({ page }) => {
  await page.getByRole('button', { name: /liste des stations/ }).click()

  // The header keeps the real total; the list itself is capped
  await expect(page.getByText(`${TOTAL} stations dans la zone`)).toBeVisible()
  const rows = page.locator('button[aria-label^="Voir "][aria-label$="sur la carte"]')
  await expect(rows).toHaveCount(CAP)

  // The last visible row is the CAP-th cheapest, not the most expensive
  await expect(rows.last()).toContainText((1.6 + (CAP - 1) * 0.01).toFixed(2).replace('.', ','))

  const more = page.getByTestId('zone-list-more')
  await expect(more).toContainText(`Afficher ${TOTAL - CAP} autres stations`)
  await expect(more).toContainText(`Les ${CAP} moins chères`)

  await more.click()
  await expect(rows).toHaveCount(TOTAL)
  await expect(more).toHaveCount(0)

  // Closing the sheet resets: reopening leads with the best picks again
  // (positioned click: the overlay spans the stage, its center is under the sheet)
  await page.getByRole('button', { name: 'Fermer la liste' }).click({ position: { x: 20, y: 20 } })
  await page.getByRole('button', { name: /liste des stations/ }).click()
  await expect(rows).toHaveCount(CAP)
})
