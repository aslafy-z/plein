import { test, expect, gotoMap } from './fixtures'

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

test('fuel chip cycles through all six fuels back to Gazole', async ({ page }) => {
  await page.getByText('Gazole ↻').click()
  await expect(page.getByText('SP95-E10 ↻')).toBeVisible()
  for (const fuel of ['SP95-E10', 'SP98', 'SP95', 'E85', 'GPLc']) {
    await page.getByText(`${fuel} ↻`).click()
  }
  await expect(page.getByText('Gazole ↻')).toBeVisible()
})

test('searching a place moves the zone, reset returns to my position', async ({ page }) => {
  await page.getByText('Chercher un lieu ou un trajet…').click()
  await page.locator('input[placeholder="Ville, adresse…"]').fill('Marseille')
  await page.getByText(/voir les stations ici/).first().click()

  await expect(page.getByText('La moins chère dans cette zone')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Marseille').first()).toBeVisible()

  await page.getByRole('button', { name: 'Revenir à ma position' }).click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
})

test('filters sheet opens and applies', async ({ page }) => {
  await page.getByText(/^Filtres · \d+$/).click()
  await expect(page.getByText('Rayon de recherche')).toBeVisible()
  await page.getByText(/^Voir \d+ stations?$/).click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
})

test('selecting favorite brands keeps only their stations', async ({ page }) => {
  await page.getByText(/^Filtres · \d+$/).click()
  // The brand list is collapsed behind an accordion — expand it first.
  await page.getByRole('button', { name: /^Distributeurs/ }).click()
  await page.getByText('Intermarché', { exact: true }).click()
  await page.getByText(/^Voir \d+ stations?$/).click()

  const handle = page.getByRole('button', { name: /liste des stations/ })
  await handle.click()
  await expect(page.getByText('Intermarché · Les Vignes').first()).toBeVisible()
  await expect(page.getByText('TotalEnergies · Centre')).toHaveCount(0)

  // The selection survives a reload (persisted with the settings) and shows
  // in the collapsed accordion header…
  await page.reload()
  await expect(page.getByText(/^Filtres · \d+$/)).toBeVisible({ timeout: 15_000 })
  await page.getByText(/^Filtres · \d+$/).click()
  await expect(page.getByRole('button', { name: /Distributeurs Intermarché/ })).toBeVisible()
  // …and clears with the filters
  await page.getByText('Réinitialiser').click()
  await expect(page.getByRole('button', { name: /Distributeurs Tous/ })).toBeVisible()
})

test('pull-up sheet lists the zone stations, a row selects on the map', async ({ page }) => {
  const handle = page.getByRole('button', { name: /liste des stations/ })
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

  await page.locator('button[aria-label^="Voir "][aria-label$="sur la carte"]').nth(1).click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible()

  await page.getByRole('button', { name: 'Désélectionner la station' }).click()
  await expect(page.getByText(/La moins chère/).first()).toBeVisible()
})

test('swiping the list down from its top closes the sheet', async ({ page }) => {
  const handle = page.getByRole('button', { name: /liste des stations/ })
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
  const handle = page.getByRole('button', { name: /liste des stations/ })
  const box = await page.getByText('La moins chère près de vous').boundingBox()
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
  const handle = page.getByRole('button', { name: /liste des stations/ })
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
  const handle = page.getByRole('button', { name: /liste des stations/ })
  await handle.click()
  // The scrim spans the whole stage but the expanded sheet (above it) covers
  // its center — Playwright's default click point. Tap near the top, on the
  // strip of dimmed map the sheet never reaches (≥ 64px stays free).
  await page
    .getByRole('button', { name: 'Fermer la liste' })
    .click({ position: { x: 40, y: 30 } })
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
})

test('station detail opens from the sheet and jumps back with the station selected', async ({ page }) => {
  await page.getByText(/MàJ /).first().click()

  await expect(page.locator('[aria-label="Carte de la station"]')).toBeVisible()
  await expect(page.getByText(/Ouvert|Fermé/).first()).toBeVisible()

  await page.getByText('Voir sur la carte ›').click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible({ timeout: 15_000 })
})

test('the user zoom survives a detail round-trip via the back button', async ({ page }) => {
  // Current zoom level, read from the tile URLs (…/{z}/{x}/{y}.png). Max
  // across the tiles: during/right after an animation Leaflet still holds
  // the outgoing level's tiles, and we only ever zoom IN here.
  const tileZoom = async () => {
    const srcs = await page
      .locator('.leaflet-tile')
      .evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src))
    const zooms = srcs
      .map((s) => s.match(/\/(\d+)\/\d+\/\d+(?:@2x)?\.png/))
      .filter((m): m is RegExpMatchArray => m != null)
      .map((m) => Number(m[1]))
    if (!zooms.length) throw new Error('no tiles on the map')
    return Math.max(...zooms)
  }
  const initial = await tileZoom()

  // Wheel-zoom over the map center: the user takes the view over (a wheel
  // zooms the map even over a pin, unlike a double-click)
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // Retry the wheel itself: a notch landing mid-animation can be dropped
  await expect(async () => {
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(250)
    expect(await tileZoom()).toBeGreaterThan(initial)
  }).toPass()
  await page.waitForTimeout(500) // let the zoom animation settle
  const zoomed = await tileZoom()

  // Detail round-trip with the (Android) back button
  await page.getByText(/MàJ /).first().click()
  await expect(page.locator('[aria-label="Carte de la station"]')).toBeVisible()
  await page.goBack()

  await expect(page.getByText(/La moins chère/).first()).toBeVisible({ timeout: 15_000 })
  await expect(async () => {
    expect(await tileZoom()).toBe(zoomed)
  }).toPass()
})

test('panning the map auto-loads stations of the new area', async ({ page }) => {
  const box = await page.locator('.leaflet-container').first().boundingBox()
  if (!box) throw new Error('map container not found')

  // Zone mode reached: either the zone sheet, or — when the pan left the demo
  // dataset's coverage — the empty bar. Both prove stations reloaded there.
  const zone = page
    .getByText('La moins chère dans cette zone')
    .or(page.getByText('Aucune station ne correspond'))

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
