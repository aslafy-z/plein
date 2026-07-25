// Keyboard navigation runs on its own animation-frame loop (lib/mapKeyboard):
// holding an arrow glides the map instead of stepping it, and +/- land on a
// whole zoom level. Leaflet's own handler moved one 80 px step per keypress
// and ignored every key pressed while that step animated.
import { test, expect, gotoMap, mapZoom } from './fixtures'

type Sample = { t: number; x: number; y: number }

/** Records the map pane's own transform — what a frame-by-frame pan moves */
async function recordPane(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const pane = document.querySelector('.leaflet-map-pane') as HTMLElement
    const samples: { t: number; x: number; y: number }[] = []
    const w = window as unknown as { __pane: typeof samples; __paneRaf: number }
    w.__pane = samples
    const read = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(pane).transform)
      samples.push({ t: performance.now(), x: m.m41, y: m.m42 })
      w.__paneRaf = requestAnimationFrame(read)
    }
    read()
  })
}

async function stopRecording(page: import('@playwright/test').Page): Promise<Sample[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __pane: Sample[]; __paneRaf: number }
    cancelAnimationFrame(w.__paneRaf)
    return w.__pane
  })
}

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
  // The map takes the keyboard the moment it holds the focus — a click does
  // it in the app, `focus()` here so no pin can be hit on the way
  await page.locator('.leaflet-container').first().focus()
})

test('a held arrow glides the map instead of stepping it', async ({ page }) => {
  await recordPane(page)
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(600)
  const released = await page.evaluate(() => performance.now())
  await page.keyboard.up('ArrowRight')
  await page.waitForTimeout(300)
  const samples = await stopRecording(page)

  const xs = samples.map((s) => s.x)
  // 600 ms of hold cover several screens' worth of Leaflet's 80 px step
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(250)

  // …and they cover it CONTINUOUSLY: from the moment the ramp-up gets the map
  // going, no frame stalls the way a step waiting for the next keypress did.
  //
  // The stall bound is the assertion that carries this — a 600 ms hold with no
  // gap over 120 ms IS continuous motion. How MANY frames a machine manages in
  // those 600 ms is not a property of the app: it fell from ~34 to ~12 on CI
  // just by giving the desktop layout a map twice the area to paint, so the
  // count below only guards against sampling nothing at all.
  const moving = samples.filter((s, i) => i > 0 && s.x !== samples[i - 1].x && s.t < released)
  expect(moving.length).toBeGreaterThan(8)
  const stalls = moving.map((s, i) => (i === 0 ? 0 : s.t - moving[i - 1].t))
  expect(Math.max(...stalls)).toBeLessThan(120)

  // Per-frame DISPLACEMENT is not a third assertion worth having, and it is
  // worth saying why: the sampler and the pan share the main thread, so a busy
  // machine delivers fewer, longer frames — 68px in one frame on CI is the same
  // velocity as 14px in one frame here. Only the two bounds above are about the
  // app rather than the runner: over a 600ms hold, a stepped handler cannot
  // cover 250px (it drops the repeats that arrive mid-animation) and cannot
  // avoid the idle gaps between its steps.
})

test('a tap on + zooms exactly one whole level', async ({ page }) => {
  const before = await mapZoom(page)
  await page.keyboard.down('+')
  await page.keyboard.up('+')

  await expect(async () => {
    expect(await mapZoom(page)).toBe(before + 1)
  }).toPass()
})

test('holding + zooms further, and still lands on a whole level', async ({ page }) => {
  const before = await mapZoom(page)
  await page.keyboard.down('+')
  await page.waitForTimeout(700)
  await page.keyboard.up('+')

  await expect(async () => {
    const after = await mapZoom(page)
    expect(after).toBeGreaterThanOrEqual(before + 2)
    expect(Number.isInteger(after)).toBe(true)
  }).toPass()
})
