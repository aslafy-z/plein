import { test, expect, gotoMap, openZoneList, closeZoneList, phoneOnly } from './fixtures'
import type { Page } from '@playwright/test'

// The zone-count math is unit-tested (selectVisible) — these tests check the
// sheet's WIRING: counts land on the buttons and the map chip, and the
// « fuel not sold here » empty state guides the user out. The demo zone
// around Toulouse Capitole holds exactly 6 stations within the default 5 km.

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

/** A paced pull on the sheet handle that parks before releasing, so the
    release votes on position alone — a fast final step would read as a fling
    and decide the direction regardless of how far the sheet travelled. */
async function dragHandle(page: Page, dy: number) {
  const handle = page
    .getByRole('dialog', { name: 'Filters' })
    .getByRole('button', { name: 'Close', exact: true })
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x, y + (dy * i) / 12)
  }
  await page.waitForTimeout(250)
  await page.mouse.up()
}

// The station-list sheet's gesture, on the filter sheet: the handle drags it
// down. A short pull springs back; past halfway the sheet slides off and
// closes (ModalSheet's engine — the desktop popover has no handle at all).
test.describe('handle drag', () => {
  phoneOnly('the desktop filters are a popover, not a draggable sheet')

  test('a short pull springs back, a long one dismisses the sheet', async ({ page }) => {
    await page.getByText('Filters · 6').click()
    const sheet = page.getByRole('dialog', { name: 'Filters' })
    await expect(sheet).toBeVisible()
    const height = (await sheet.boundingBox())!.height

    // Well short of halfway: released, the sheet springs back and stays
    await dragHandle(page, Math.min(60, height / 4))
    await expect(sheet).toBeVisible()
    await expect(page.getByText('Show 6 stations')).toBeVisible()

    // Past halfway: the release slides it off and hands back the map
    await dragHandle(page, height * 0.7)
    await expect(sheet).toBeHidden()
    await expect(page.getByText('Filters · 6')).toBeVisible()
  })
})

test('service filters narrow the live count and « Reset » restores it', async ({ page }) => {
  await page.getByText('Filters · 6').click()

  // 4 of the 6 zone stations are open 24/7 (not Carrefour Market, not Garage Morel)
  await page.getByRole('button', { name: 'Open 24/7', exact: true }).click()
  await expect(page.getByText('Show 4 stations')).toBeVisible()
  await page.getByText('Show 4 stations').click()
  await expect(page.getByText('Filters · 4')).toBeVisible()

  // The list only keeps the matching stations
  await openZoneList(page)
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible()
  await expect(page.getByText('Carrefour Market')).toHaveCount(0)
  await closeZoneList(page)

  // « Reset » clears the selection with the rest of the filters
  await page.getByText('Filters · 4').click()
  await page.getByText('Reset').click()
  await expect(page.getByText('Show 6 stations')).toBeVisible()
})

test('brand rows count with the other filters applied, never promising an empty map', async ({ page }) => {
  await page.getByText('Filters · 6').click()
  // 4 of the 6 zone stations sell E85 — BP · Rocade Est and Garage Morel don't
  await page.getByRole('button', { name: 'E85', exact: true }).click()
  await expect(page.getByText('Show 4 stations')).toBeVisible()

  await page.getByRole('button', { name: /^Brands/ }).click()
  // BP's only zone station has no E85 pump: the row leaves the counted list
  // for the « kept for a next trip » chips instead of advertising « 1 »
  await expect(page.getByRole('button', { name: 'BP 1' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'BP', exact: true })).toBeVisible()

  // …and a counted row delivers exactly the stations it announces
  const total = page.getByRole('button', { name: 'TotalEnergies 1' })
  await expect(total).toBeVisible()
  await total.click()
  await expect(page.getByText('Show 1 station', { exact: true })).toBeVisible()
})

// AdBlue is the one service tag whose absence can mean « the source never
// says ». The demo fixture declares it like the Spanish and Andorran fluxes
// do, so the chip is offered and it bites: 2 of the 6 zone stations sell it.
test('the AdBlue filter narrows the zone and survives a reload', async ({ page }) => {
  await page.getByText('Filters · 6').click()

  const chip = page.getByRole('button', { name: 'AdBlue', exact: true })
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  // Only TotalEnergies · Centre and BP · Rocade Est dispense it
  await expect(page.getByText('Show 2 stations')).toBeVisible()
  // …and the caveat about the sources that publish nothing is on screen
  await expect(page.getByText(/French and Portuguese stations stay listed/)).toBeVisible()
  await page.getByText('Show 2 stations').click()
  await expect(page.getByText('Filters · 2')).toBeVisible()

  await openZoneList(page)
  await expect(page.getByText('TotalEnergies · Centre').first()).toBeVisible()
  await expect(page.getByText('Station U · Croix-Blanche')).toHaveCount(0)
  await closeZoneList(page)

  // The selection is in the settings blob: landing on a bare URL, which
  // carries no filter of its own, must still come back to the same map
  // (`map-share.spec` covers the link half of the round trip)
  await page.goto('/')
  await expect(page.getByText('Filters · 2')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Filters · 2').click()
  await expect(page.getByRole('button', { name: 'AdBlue', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the fiche prices AdBlue where the source declares one', async ({ page }) => {
  // Presence AND price on BP · Rocade Est, the one demo station priced the way
  // the Spanish and Andorran fluxes price theirs…
  await page.goto('/station/bp')
  await expect(page.getByText(/AdBlue\s*0\.89\s*€\/L/)).toBeVisible({ timeout: 15_000 })

  // …and a bare chip where the source declares presence only
  await page.goto('/station/te')
  await expect(page.getByText('AdBlue', { exact: true })).toBeVisible({ timeout: 15_000 })
})

test('a fuel nobody sells in the zone names itself and offers what IS sold', async ({ page }) => {
  // No station within 5 km sells LPG (the demo LPG pumps sit farther out)
  await page.getByText('Filters · 6').click()
  await page.getByRole('button', { name: 'LPG', exact: true }).click()
  // The count goes through CLDR plural rules: English selects `other` for 0
  // (« Show 0 stations »), which the hand-rolled plural helper this replaced
  // got wrong
  await expect(page.getByText('Show 0 stations', { exact: true })).toBeVisible()
  await page.getByText('Show 0 stations', { exact: true }).click()

  // The empty state must name the culprit, not look broken…
  await expect(page.getByText('No station sells LPG in this area.')).toBeVisible()
  await expect(page.getByText('Sold here:')).toBeVisible()

  // …and its chips switch straight to a fuel the zone actually sells
  await page.getByRole('button', { name: 'Diesel', exact: true }).click()
  await expect(page.getByText('The cheapest near you')).toBeVisible()
  await expect(page.getByText('Diesel ↻')).toBeVisible()
})
