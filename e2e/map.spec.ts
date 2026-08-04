import { test, expect, gotoMap, mapZoom, openZoneList, phoneOnly } from './fixtures'

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

test('fuel chip cycles through all six fuels back to Diesel', async ({ page }) => {
  await page.getByText('Diesel ↻').click()
  await expect(page.getByText('E10 ↻')).toBeVisible()
  for (const fuel of ['E10', 'Unleaded 98', 'Unleaded 95', 'E85', 'LPG']) {
    await page.getByText(`${fuel} ↻`).click()
  }
  await expect(page.getByText('Diesel ↻')).toBeVisible()
})

test('searching a place moves the zone, reset returns to my position', async ({ page }) => {
  await page.getByText('Search a place or a route…').click()
  await page.locator('input[placeholder="Town, address…"]').fill('Marseille')
  await page.getByText(/see the stations here/).first().click()

  // The heading names the reco (« The cheapest » / « The best choice »),
  // which is the scoring's business — this spec only asserts the zone MOVED.
  // Since 1fb3ad6 a zone out of the tank's round-trip range crowns its
  // nearest station, so Marseille seen from Toulouse is a « best choice ».
  await expect(page.getByText(/in this area/).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Marseille').first()).toBeVisible()

  await page.getByRole('button', { name: 'Back to my position' }).click()
  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
})

test('filters sheet opens and applies', async ({ page }) => {
  await page.getByText(/^Filters · \d+$/).click()
  await expect(page.getByText('Search radius')).toBeVisible()
  await page.getByText(/^Show \d+ stations?$/).click()
  await expect(page.getByText('The cheapest near you')).toBeVisible()
})

test('selecting favorite brands keeps only their stations', async ({ page }) => {
  await page.getByText(/^Filters · \d+$/).click()
  // The brand list is collapsed behind an accordion — expand it first.
  await page.getByRole('button', { name: /^Brands/ }).click()
  await page.getByText('Intermarché', { exact: true }).click()
  await page.getByText(/^Show \d+ stations?$/).click()

  await openZoneList(page)
  await expect(page.getByText('Intermarché · Les Vignes').first()).toBeVisible()
  await expect(page.getByText('TotalEnergies · Centre')).toHaveCount(0)

  // The selection survives a reload (persisted with the settings) and shows
  // in the collapsed accordion header…
  await page.reload()
  await expect(page.getByText(/^Filters · \d+$/)).toBeVisible({ timeout: 15_000 })
  await page.getByText(/^Filters · \d+$/).click()
  await expect(page.getByRole('button', { name: /Brands Intermarché/ })).toBeVisible()
  // …and clears with the filters
  await page.getByText('Reset').click()
  await expect(page.getByRole('button', { name: /Brands All/ })).toBeVisible()
})

// ── Sheet gestures ─────────────────────────────────────────────────────────
// The sheet itself only exists on a phone: a window docks the list beside the
// map, always open, so there is nothing to pull, fling or tap away. What these
// tests cover functionally — a row selecting its station on the map — is
// checked for the docked panel in desktop.spec.ts.
test.describe('the bottom sheet', () => {
  phoneOnly()

  test('pull-up sheet lists the zone stations, a row selects on the map', async ({ page }) => {
    const handle = page.getByRole('button', { name: /list of stations/ })
    const before = (await handle.boundingBox())?.y ?? 0
    await handle.click()
    // The sheet must expand upwards AND settle: a row tapped while the open
    // animation still runs can land on whatever slid under the tap point.
    let last = Number.NaN
    await expect(async () => {
      const after = (await handle.boundingBox())?.y ?? 0
      const settled = after === last && after < before - 100
      last = after
      expect(settled, 'the sheet must expand upwards and settle').toBe(true)
    }).toPass()

    await page.locator('button[aria-label^="Show "][aria-label$="on the map"]').nth(1).click()
    await expect(page.getByText('Selected station')).toBeVisible()

    await page.getByRole('button', { name: 'Deselect the station' }).click()
    await expect(page.getByText(/The cheapest/).first()).toBeVisible()
  })

  test('swiping the list down from its top closes the sheet', async ({ page }) => {
    const handle = page.getByRole('button', { name: /list of stations/ })
    await handle.click()
    await expect(handle).toHaveAttribute('aria-expanded', 'true')
    await page.waitForTimeout(400) // open animation

    const box = await page.getByTestId('zone-list').boundingBox()
    if (!box) throw new Error('zone list not visible')
    await page.mouse.move(box.x + box.width / 2, box.y + 20)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 320, { steps: 12 })
    await page.mouse.up()

    await expect(handle).toHaveAttribute('aria-expanded', 'false')
  })

  test('a quick upward flick on the station card opens the list', async ({ page }) => {
    const handle = page.getByRole('button', { name: /list of stations/ })
    const box = await page.getByText('The cheapest near you').boundingBox()
    if (!box) throw new Error('station card not visible')

    // Short (way under half the travel) but fast → the fling rule must open
    const x = box.x + box.width / 2
    await page.mouse.move(x, box.y + 4)
    await page.mouse.down()
    await page.mouse.move(x, box.y - 110, { steps: 3 })
    await page.mouse.up()

    await expect(handle).toHaveAttribute('aria-expanded', 'true')
  })

  test('swiping down a scrolled list scrolls it instead of closing the sheet', async ({ page }) => {
    const handle = page.getByRole('button', { name: /list of stations/ })
    await handle.click()
    await page.waitForTimeout(400)

    const list = page.getByTestId('zone-list')
    const scrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 10)
    test.skip(!scrollable, 'the demo list fits this viewport without scrolling')

    await list.evaluate((el) => {
      el.scrollTop = 50
    })
    const box = await list.boundingBox()
    if (!box) throw new Error('zone list not visible')
    await page.mouse.move(box.x + box.width / 2, box.y + 20)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + 250, { steps: 10 })
    await page.mouse.up()

    await expect(handle).toHaveAttribute('aria-expanded', 'true')
  })

  test('tapping the dimmed map closes the list', async ({ page }) => {
    const handle = page.getByRole('button', { name: /list of stations/ })
    await handle.click()
    // The scrim spans the whole stage but the expanded sheet (above it) covers
    // its center — Playwright's default click point. Tap near the top, on the
    // strip of dimmed map the sheet never reaches (≥ 64px stays free).
    await page
      .getByRole('button', { name: 'Close the list' })
      .click({ position: { x: 40, y: 30 } })
    await expect(handle).toHaveAttribute('aria-expanded', 'false')
  })
})

// « Show on the map › » is the phone's bridge from the full-screen fiche back
// to the map — the desktop fiche sits NEXT to the live map, which is already
// showing the station, so the button (and this flow) doesn't exist there
test.describe('fiche → map bridge', () => {
  phoneOnly('the desktop fiche has no « Show on the map » — the live map is beside it')

  test('station detail opens from the sheet and jumps back with the station selected', async ({ page }) => {
    await page.getByText(/Upd\. /).first().click()

    await expect(page.getByText('Show on the map ›')).toBeVisible()
    await expect(page.getByText(/Open|Closed/).first()).toBeVisible()

    await page.getByText('Show on the map ›').click()
    await expect(page.getByText('Selected station')).toBeVisible({ timeout: 15_000 })
  })
})

test('the user zoom survives a detail round-trip via the back button', async ({ page }) => {
  const zoom = () => mapZoom(page)
  const initial = await zoom()

  // Wheel-zoom over the map center: the user takes the view over (a wheel
  // zooms the map even over a pin, unlike a double-click)
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // Retry the wheel itself: a notch landing mid-animation can be dropped
  await expect(async () => {
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(250)
    expect(await zoom()).toBeGreaterThan(initial)
  }).toPass()
  await page.waitForTimeout(500) // let the zoom animation settle
  const zoomed = await zoom()

  // Detail round-trip with the (Android) back button — « Services » is the
  // fiche section both arrangements render
  await page.getByText(/Upd\. /).first().click()
  await expect(page.getByText('Services')).toBeVisible()
  await page.goBack()

  // Back on the map — the card's kicker depends on where the zoomed view
  // landed (the cheapest station of the zone is not always the recommended
  // one), and which of the two shows is not what this test is about
  await expect(
    page.getByText(/The cheapest|The best choice/).first(),
  ).toBeVisible({ timeout: 15_000 })
  await expect(async () => {
    expect(await zoom()).toBe(zoomed)
  }).toPass()
})

test('panning the map auto-loads stations of the new area', async ({ page }) => {
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')

  // Zone mode reached: either the zone sheet, or — when the pan left the demo
  // dataset's coverage — the empty bar. Both prove stations reloaded there.
  const zone = page
    .getByText('The cheapest in this area')
    .or(page.getByText('No station matches'))

  // How far one drag pans depends on the auto-fit zoom, so drag until the
  // app leaves « near you » mode instead of a fixed number of times.
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(cx + 130, cy + 100)
    await page.mouse.down()
    await page.mouse.move(cx - 140, cy - 110, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(700) // moveend debounce (350 ms) + reload
    if (await zone.first().isVisible()) break
  }

  await expect(zone.first()).toBeVisible({ timeout: 15_000 })
})
