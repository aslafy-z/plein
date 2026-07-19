import { test, expect, gotoMap } from './fixtures'

// Dense areas: only the PIN_CAP (15) cheapest stations wear a price bubble on
// the map — those inside the search circle first — the rest shrink to small
// dots (still tappable) and a passive chip says how many. Selecting a dot
// promotes it to a full price pin.

test.use({ seed: { sourceId: 'gouv', onboarded: true } })

const FAR = 4 // the FAR cheapest stations sit OUTSIDE the 5 km circle
const NEAR = 18 // stations inside the circle, all pricier than the far ones
const TOTAL = FAR + NEAR
const CAP = 15

test.beforeEach(async ({ page }) => {
  // Deterministic gouv flux: prices strictly increase with the index, and the
  // cheapest FAR stations are placed ~7 km out — beyond the default 5 km
  // radius but inside the fetched area — so the circle-priority is observable.
  await page.route('**/proxy/gouv/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    const lng = m ? parseFloat(m[1]) : 1.44
    const lat = m ? parseFloat(m[2]) : 43.6
    const results = Array.from({ length: TOTAL }, (_, i) => {
      const far = i < FAR
      const angle = far ? (Math.PI / 2) * (1 + 2 * i) : (2 * Math.PI * i) / NEAR
      const dLat = far ? 0.063 * Math.sin(angle) : 0.015 * Math.sin(angle)
      const dLng = far ? 0.085 * Math.cos(angle) : 0.02 * Math.cos(angle)
      return {
        id: `e2e-${i}`,
        ville: 'Testville',
        adresse: `${i} rue du Test`,
        geom: { lat: lat + dLat, lon: lng + dLng },
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

test('a dense zone shows its 15 cheapest as price pins, the rest as dots', async ({ page }) => {
  const bubbles = page.locator('.pin-bubble')
  const dots = page.locator('.pin-dot')

  await expect(bubbles).toHaveCount(CAP)
  await expect(dots).toHaveCount(TOTAL - CAP)

  // Circle priority: the map's cheapest stations sit OUTSIDE the circle and
  // still get NO bubble — all 15 bubbles belong to in-zone stations, whose
  // cheapest (index FAR) is the highlighted best pin.
  for (let i = 0; i < FAR; i++) {
    const price = (1.6 + i * 0.01).toFixed(2).replace('.', ',')
    await expect(page.locator('.pin-bubble', { hasText: price })).toHaveCount(0)
  }
  const bestZonePrice = (1.6 + FAR * 0.01).toFixed(2).replace('.', ',')
  await expect(page.locator('.pin-bubble', { hasText: bestZonePrice })).toBeVisible()

  // The passive chip counts the ZONE (the circle), like every other count in
  // the app — the 4 far dots and the rest of the fetched area must not
  // inflate it: 18 in-zone stations → 15 bubbles + 3 dots.
  await expect(page.getByTestId('pin-cap-hint')).toContainText(
    `Zone : les ${CAP} moins chères · ${NEAR - CAP} en points`,
  )

  // Tapping a dot selects the station and promotes it to a full price pin
  // (the last dot is an in-zone one — the far ones may sit outside the view)
  await dots.last().click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible()
  await expect(bubbles).toHaveCount(CAP + 1)
  await expect(dots).toHaveCount(TOTAL - CAP - 1)
})

test('when the circle overflows the screen, the visible part becomes the zone', async ({ page }) => {
  await expect(page.locator('.pin-bubble')).toHaveCount(CAP)
  await expect(page.getByTestId('pin-cap-hint')).toBeVisible()

  // Zoom well into the circle (native double-click zoom): far fewer than CAP
  // zone stations stay in view
  const stage = await page.locator('.leaflet-container').first().boundingBox()
  if (!stage) throw new Error('map container not found')
  for (let i = 0; i < 5; i++) {
    await page.mouse.dblclick(stage.x + stage.width / 2, stage.y + stage.height / 2)
    await page.waitForTimeout(500)
  }

  // The visible part of the circle is now the zone: every station on screen
  // wears a price bubble (the cap re-ranks to the view), no dot is left in
  // sight, and the chip has nothing to announce
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const stage = document.querySelector('.leaflet-container')!.getBoundingClientRect()
          const inView = (el: Element) => {
            const r = el.getBoundingClientRect()
            return r.right > stage.left && r.left < stage.right && r.bottom > stage.top && r.top < stage.bottom
          }
          return {
            dots: [...document.querySelectorAll('.pin-dot')].filter(inView).length,
            bubbles: [...document.querySelectorAll('.pin-bubble')].filter(inView).length,
          }
        }),
      { timeout: 8000 },
    )
    .toMatchObject({ dots: 0 })
  await expect(page.getByTestId('pin-cap-hint')).toBeHidden()
})
