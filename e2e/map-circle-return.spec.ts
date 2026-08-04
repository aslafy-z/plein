import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// Tapping a pin pans the map onto its station, and hopping through two or
// three of them can leave the search circle a viewport or more behind. The
// glide absorbs the leftover circle↔center gap at 35% of the pan distance —
// right for a circle in view, but from that far away it demanded several
// screens of dragging before the zone returned. A gesture that BEGINS with
// the circle's center off screen also decays the gap per frame
// (OFFSET_FAR_DECAY in MapCanvas): the invariant here is that ONE ordinary
// drag brings the circle back around the center, not a sliver of the way.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

/**
 * Deterministic fra flux: a chain of stations marching north from the first
 * requested center every 3 km — however far the pin-hopping has carried the
 * view, the next pin is in sight. Anchored on the FIRST request so the
 * refetches fired while the circle drags never move the chain.
 */
async function mockStationChain(page: Page) {
  let base: { lat: number; lng: number } | null = null
  await page.route('**/proxy/fra/**', async (route) => {
    const where = new URL(route.request().url()).searchParams.get('where') ?? ''
    const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(where)
    base ??= { lat: m ? parseFloat(m[2]) : 43.6, lng: m ? parseFloat(m[1]) : 1.44 }
    const results = Array.from({ length: 14 }, (_, i) => ({
      id: `e2e-hop-${i}`,
      ville: 'Testville',
      adresse: `${i} rue du Test`,
      geom: { lat: base!.lat + (i === 0 ? 0.5 : i * 3) / 111, lon: base!.lng },
      gazole_prix: (1.7 + i * 0.01).toFixed(3),
    }))
    await route.fulfill({ json: { total_count: results.length, results } })
  })
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
}

/**
 * Screen center of the search circle, read off its SVG path. Only valid
 * while the circle is around the view: the renderer clips the path to the
 * viewport (+ a buffer) on moveend, so a far-off circle's box pins to the
 * nearest edge. The far measurements below use the chain's first pin — a
 * DOM marker, immune to clipping — as the zone's proxy instead.
 */
async function circleCenter(page: Page) {
  return page.evaluate(() => {
    const path = document.querySelector('.leaflet-overlay-pane path')
    if (!path) return null
    const r = path.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
}

/** Screen point of the chain's first pin — 0.5 km from the circle center */
async function zonePin(page: Page) {
  const r = await page
    .locator('.pin-bubble', { hasText: '1,70' })
    .evaluate((el) => el.getBoundingClientRect())
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}

/** A paced drag: one step per frame so the glide gets real move events */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  const steps = 16
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
}

test('one drag brings the circle back after pin-hopping away from the zone', async ({ page }) => {
  await mockStationChain(page)
  const stage = await page.locator('.leaflet-container').boundingBox()
  expect(stage).not.toBeNull()
  const cx = stage!.x + stage!.width / 2
  const cy = stage!.y + stage!.height / 2
  const gapToZone = async () => {
    const p = await zonePin(page)
    return Math.hypot(p.x - cx, p.y - cy)
  }

  // Hop pins away from the zone: tap the visible pin farthest from the
  // circle until its center has left the viewport by a comfortable margin.
  // Candidates stay inside the map stage, clear of the search pill (top),
  // the sheet/card (bottom) and the map controls (right edge).
  for (let hop = 0; hop < 10 && (await gapToZone()) < 550; hop++) {
    const circle = await zonePin(page)
    const target = await page.evaluate(
      ({ circle, stage }) => {
        let best: { x: number; y: number; d: number } | null = null
        for (const el of document.querySelectorAll('.pin-bubble')) {
          const r = el.getBoundingClientRect()
          const x = r.x + r.width / 2
          const y = r.y + r.height / 2
          if (x < stage.x + 16 || x > stage.x + stage.width - 70) continue
          if (y < stage.y + 130 || y > stage.y + stage.height - 300) continue
          const d = circle ? Math.hypot(x - circle.x, y - circle.y) : y
          if (!best || d > best.d) best = { x, y, d }
        }
        return best
      },
      { circle, stage: stage! },
    )
    expect(target, 'a pin to hop to must be in view').not.toBeNull()
    await page.mouse.click(target!.x, target!.y)
    await expect(page.getByText('Station sélectionnée')).toBeVisible()
    await page.waitForTimeout(800) // the pan-to-station animation
  }

  const before = await gapToZone()
  expect(before, 'the hops must have left the circle far behind').toBeGreaterThan(550)

  await drag(page, { x: cx, y: cy }, -110, 90)
  await page.waitForTimeout(400)
  await drag(page, { x: cx, y: cy }, 110, -90)
  await page.waitForTimeout(500)

  // The drawn circle (readable again now that it is back in view) must be
  // around the visible center — which sits up to half an inset from the
  // stage center — not merely 35% of two drags closer to it
  const c = await circleCenter(page)
  expect(c).not.toBeNull()
  const after = Math.hypot(c!.x - cx, c!.y - cy)
  expect(after).toBeLessThan(350)
  expect(before - after).toBeGreaterThan(before * 0.6)
})
