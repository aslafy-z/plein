import { test, expect, gotoMap } from './fixtures'

// The « Force offline mode » switch (Settings › Offline data) must stop every
// station fetch while it holds — the connection here stays perfectly healthy,
// which is exactly what tells forced offline apart from real offline: the
// mock would answer, and the request counter proves it was never asked.
// A standing banner owns up from the moment the switch flips (without the
// futile retry the failure banners carry), and releasing the switch
// revalidates on its own, like connectivity returning.

test.use({ seed: { sourceId: 'fr', onboarded: true } })

const FORCED = 'Offline mode forced — the prices shown may be out of date.'

// Deterministic gouv flux: echo one station near the queried center.
function fulfillStations(route: import('@playwright/test').Route) {
  const where = new URL(route.request().url()).searchParams.get('where') ?? ''
  const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
  const lng = m ? parseFloat(m[1]) : 1.44
  const lat = m ? parseFloat(m[2]) : 43.6
  return route.fulfill({
    json: {
      total_count: 1,
      results: [
        {
          id: 'e2e-1',
          ville: 'Testville',
          adresse: '1 rue du Test',
          geom: { lat: lat + 0.01, lon: lng },
          gazole_prix: '1.80',
        },
      ],
    },
  })
}

/** Drag the map by (dx, dy) css pixels, starting clear of the desktop panel */
async function drag(page: import('@playwright/test').Page, dx: number, dy: number) {
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  const sx = box.x + box.width * (dx > 0 ? 0.7 : 0.35)
  const sy = box.y + box.height * (dy > 0 ? 0.55 : 0.35)
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx - dx, sy - dy, { steps: 8 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.route('**/brands-fr.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
})

test('the switch stops station fetches, and releasing it revalidates alone', async ({ page }) => {
  let requests = 0
  await page.route('**/proxy/fr/**', (route) => {
    requests++
    return fulfillStations(route)
  })
  await gotoMap(page)
  const loaded = requests
  expect(loaded).toBeGreaterThan(0)

  // Flip the switch: the standing banner appears at once, before any attempt
  await page.getByRole('button', { name: 'Settings' }).click()
  const toggle = page.getByTestId('force-offline-toggle')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(FORCED)).toBeVisible()

  // Drag beyond the fetched 25 km area: the attempt is skipped as offline,
  // so the failure state lands without the request counter ever moving
  await page.getByRole('button', { name: 'Map' }).first().click()
  const failedZone = page.getByText('Offline — no stations stored for this area.')
  for (let i = 0; i < 12 && !(await failedZone.isVisible()); i++) {
    await drag(page, 240, 140)
    await page.waitForTimeout(500)
  }
  await expect(failedZone).toBeVisible()
  expect(requests).toBe(loaded)

  // The banner names the mode and drops its retry — an attempt cannot
  // succeed while the switch holds, the way out is the Settings switch
  const banner = page.getByTestId('fallback-banner')
  await expect(banner).toHaveText(FORCED)
  await expect(banner.getByRole('button')).toHaveCount(0)

  // Release the switch: the store revalidates on its own — no reload, no
  // retry tap — and the zone recovers through the live source
  await page.getByRole('button', { name: 'Settings' }).click()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText(FORCED)).toHaveCount(0)
  await expect.poll(() => requests, { timeout: 15_000 }).toBeGreaterThan(loaded)
  await page.getByRole('button', { name: 'Map' }).first().click()
  await expect(page.getByText(/Testville/).first()).toBeVisible({ timeout: 15_000 })
})
