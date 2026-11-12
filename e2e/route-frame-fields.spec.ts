import { test, expect } from './fixtures'

// A computed route is fitted right up to its bounds, and the endpoint fields
// float over the map's top edge: on a trip running north–south, the end at the
// top of the map used to be framed BEHIND them. The fit now treats the fields
// like the panel and the sheet — as a cover — so the trip sits centred in what
// is left between the fields and the bottom of the visible map. Runs on both
// arrangements: the fields float over the top edge in each.

type Page = import('@playwright/test').Page

/** The endpoint markers, told apart by their ring (see endpointHtml) */
const departurePin = (page: Page) =>
  page.locator('.leaflet-marker-icon:not(.user-dot) div[style*="--c-accent-deep"]')
const arrivalPin = (page: Page) => page.locator('.leaflet-marker-icon div[style*="--c-warn-deep"]')

async function centerY(pin: ReturnType<typeof departurePin>) {
  const box = await pin.boundingBox()
  expect(box).not.toBeNull()
  return box!.y + box!.height / 2
}

/** Top and bottom of the map the user can actually see */
async function visibleSpan(page: Page) {
  const fields = await page.getByTestId('route-endpoint-from').boundingBox()
  const stage = await page.locator('.leaflet-container').boundingBox()
  expect(fields).not.toBeNull()
  expect(stage).not.toBeNull()
  // A phone's collapsed sheet covers the bottom edge; its handle is its top
  const handle = page.getByRole('button', { name: /the route details/ })
  const sheetTop = (await handle.count()) ? (await handle.boundingBox())!.y : null
  return { top: fields!.y + fields!.height, bottom: sheetTop ?? stage!.y + stage!.height }
}

// Due north of Toulouse, ~145 km: the trip is a vertical line, so the fit is
// bound by the stage's height alone.
const NORTH = '44.9,1.4442'
const SOUTH = '43.6047,1.4442'

for (const [name, from, to] of [
  ['southbound', NORTH, SOUTH],
  ['northbound', SOUTH, NORTH],
] as const) {
  test(`a ${name} trip is framed between the endpoint fields and the bottom of the map`, async ({
    page,
  }) => {
    await page.goto(`/route/results?a=${from}&al=A&d=${to}&dl=B`)
    await expect(page.locator('.route-line')).toHaveCount(1)
    await expect(departurePin(page)).toHaveCount(1)
    await expect(arrivalPin(page)).toHaveCount(1)
    await expect(page.locator('.leaflet-map-pane')).not.toHaveClass(/leaflet-zoom-anim/)

    // Retried as a whole: the layer is redrawn when the corridor's stations
    // land, and a pin measured mid-redraw has no box
    await expect(async () => {
      const ys = [await centerY(departurePin(page)), await centerY(arrivalPin(page))]
      const span = await visibleSpan(page)
      const above = Math.min(...ys) - span.top
      const below = span.bottom - Math.max(...ys)

      // Clear of the fields, and as much room above the trip as under it —
      // fitted against the stage's top edge instead, the trip sits half a
      // fields row too high
      expect(above).toBeGreaterThan(0)
      expect(Math.abs(above - below)).toBeLessThanOrEqual(6)
    }).toPass({ timeout: 5000 })
  })
}
