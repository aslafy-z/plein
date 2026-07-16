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
  await expect(async () => {
    const after = (await handle.boundingBox())?.y ?? 0
    expect(after, 'the sheet must expand upwards').toBeLessThan(before - 100)
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
  await page.getByRole('button', { name: 'Fermer la liste' }).click()
  await expect(handle).toHaveAttribute('aria-expanded', 'false')
})

test('station detail opens from the sheet and jumps back with the station selected', async ({ page }) => {
  await page.getByText(/MàJ /).first().click()

  await expect(page.locator('[aria-label="Carte de la station"]')).toBeVisible()
  await expect(page.getByText(/Ouvert|Fermé/).first()).toBeVisible()

  await page.getByText('Voir sur la carte ›').click()
  await expect(page.getByText('Station sélectionnée')).toBeVisible({ timeout: 15_000 })
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
