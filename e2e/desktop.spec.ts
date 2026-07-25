import { test, expect, gotoMap, mapZoom, desktopOnly, DESKTOP_MIN_WIDTH } from './fixtures'

// The desktop arrangement (src/lib/layout.ts). Above DESKTOP_MIN_WIDTH the app
// fills the window instead of being letterboxed into a phone-shaped column:
// navigation moves to a side rail, the map runs edge to edge with the zone
// list floating over its left edge, and the filters become an anchored
// popover. This file covers that wiring — the gestures it replaces stay in
// map.spec.ts, scoped to the phone project.

desktopOnly()

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

test('the app fills the window instead of a phone-shaped column', async ({ page, viewport }) => {
  const shell = await page.locator('.app-shell').boundingBox()
  if (!shell) throw new Error('app shell not found')
  // The old layout pinned a 428px frame to the middle of the window
  expect(shell.width).toBe(viewport!.width)
  expect(shell.width).toBeGreaterThanOrEqual(DESKTOP_MIN_WIDTH)
  // …and the page itself never scrolls sideways
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
  expect(overflows, 'the window must not scroll horizontally').toBe(false)
})

test('navigation is a side rail, not a bottom tab bar', async ({ page }) => {
  // The rail carries the wordmark, which doubles as the way back to the map
  const home = page.getByRole('button', { name: /^Plein\./ })
  await expect(home).toBeVisible()

  const rail = await home.boundingBox()
  const shell = await page.locator('.app-shell').boundingBox()
  if (!rail || !shell) throw new Error('layout not measurable')
  // Top-left, where a desktop user looks for it — not on the bottom edge
  expect(rail.y).toBeLessThan(shell.height / 3)

  for (const tab of ['Carte', 'Trajet', 'Favoris', 'Réglages']) {
    await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Carte', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // Nothing to pull up: the sheet and its handle only exist on a phone
  await expect(page.getByRole('button', { name: /liste des stations/ })).toHaveCount(0)

  // The wordmark navigates home
  await page.getByRole('button', { name: 'Réglages', exact: true }).click()
  await expect(page.getByText('Carburant par défaut')).toBeVisible()
  await home.click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
})

test('the zone list floats over the map, and a row selects on it', async ({ page }) => {
  // Floating means already there — no gesture, no tap
  const list = page.getByTestId('zone-list')
  await expect(list).toBeVisible()
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible()

  const listBox = await list.boundingBox()
  const map = await page.locator('.leaflet-container').first().boundingBox()
  if (!listBox || !map) throw new Error('layout not measurable')
  // Over, not beside: the map runs edge to edge under the panel — it starts
  // left of the list and continues past its right edge
  expect(listBox.x).toBeGreaterThan(map.x)
  expect(map.x + map.width).toBeGreaterThan(listBox.x + listBox.width)

  // One click on a row: its fiche opens under the list, which stays put —
  // and closing it hands the zone card back
  await page.locator('button[aria-label^="Ouvrir la fiche"]').nth(1).click()
  await expect(page.getByText('Services')).toBeVisible()
  await expect(list).toBeVisible()

  await page.getByRole('button', { name: 'Fermer la fiche' }).click()
  await expect(page.getByText(/La moins chère/).first()).toBeVisible()
})

test('the filters are a popover: Escape and a click outside both close it', async ({ page }) => {
  const dialog = page.getByRole('dialog')

  await page.getByText(/^Filtres · \d+$/).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Rayon de recherche')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // …and a click outside, the other thing a window offers that a sheet doesn't
  await page.getByText(/^Filtres · \d+$/).click()
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Fermer les filtres' }).click({ position: { x: 20, y: 20 } })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
})

test('a station fiche stacks under the list, with the rail still up', async ({ page }) => {
  await page.getByText(/MàJ /).first().click()

  await expect(page.getByText('12 route de la Croix-Blanche · 31000 Toulouse')).toBeVisible()
  // No mini-map here: the live map right of the panel already shows the pin
  await expect(page.locator('[aria-label="Carte de la station"]')).toHaveCount(0)
  // Still oriented: the list stays up above the fiche, the navigation did
  // not disappear under a full-screen page, the live map is still there
  await expect(page.getByTestId('zone-list')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Réglages', exact: true })).toBeVisible()
  await expect(page.locator('.leaflet-container').first()).toBeVisible()

  // A narrow document stays narrow — it must not stretch across the region
  const card = await page.getByText('12 route de la Croix-Blanche · 31000 Toulouse').boundingBox()
  const shell = await page.locator('.app-shell').boundingBox()
  if (!card || !shell) throw new Error('layout not measurable')
  expect(card.width).toBeLessThan(shell.width * 0.6)

  await page.getByRole('button', { name: 'Fermer la fiche' }).click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
})

test('the map has zoom buttons, which a mouse has no other way to reach', async ({ page }) => {
  const start = await mapZoom(page)

  await page.getByRole('button', { name: 'Zoomer', exact: true }).click()
  await expect(async () => expect(await mapZoom(page)).toBe(start + 1)).toPass()

  await page.getByRole('button', { name: 'Dézoomer', exact: true }).click()
  await expect(async () => expect(await mapZoom(page)).toBe(start)).toPass()
})
