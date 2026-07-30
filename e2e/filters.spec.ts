import { test, expect, gotoMap, openZoneList, closeZoneList } from './fixtures'

// The zone-count math is unit-tested (selectVisible) — these tests check the
// sheet's WIRING: counts land on the buttons and the map chip, and the
// « fuel not sold here » empty state guides the user out. The demo zone
// around Toulouse Capitole holds exactly 6 stations within the default 5 km.

test.beforeEach(async ({ page }) => {
  await gotoMap(page)
})

test('service filters narrow the live count and Réinitialiser restores it', async ({ page }) => {
  await page.getByText('Filtres · 6').click()

  // 4 of the 6 zone stations are 24/24 (not Carrefour Market, not Garage Morel)
  await page.getByRole('button', { name: 'Ouvert 24/24', exact: true }).click()
  await expect(page.getByText('Voir 4 stations')).toBeVisible()
  await page.getByText('Voir 4 stations').click()
  await expect(page.getByText('Filtres · 4')).toBeVisible()

  // The list only keeps the matching stations
  await openZoneList(page)
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible()
  await expect(page.getByText('Carrefour Market')).toHaveCount(0)
  await closeZoneList(page)

  // Réinitialiser clears the selection with the rest of the filters
  await page.getByText('Filtres · 4').click()
  await page.getByText('Réinitialiser').click()
  await expect(page.getByText('Voir 6 stations')).toBeVisible()
})

test('brand rows count with the other filters applied, never promising an empty map', async ({ page }) => {
  await page.getByText('Filtres · 6').click()
  // 4 of the 6 zone stations sell E85 — BP · Rocade Est and Garage Morel don't
  await page.getByRole('button', { name: 'E85', exact: true }).click()
  await expect(page.getByText('Voir 4 stations')).toBeVisible()

  await page.getByRole('button', { name: /^Distributeurs/ }).click()
  // BP's only zone station has no E85 pump: the row leaves the counted list
  // for the « prochain trajet » chips instead of advertising « 1 »
  await expect(page.getByRole('button', { name: 'BP 1' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'BP', exact: true })).toBeVisible()

  // …and a counted row delivers exactly the stations it announces
  const total = page.getByRole('button', { name: 'TotalEnergies 1' })
  await expect(total).toBeVisible()
  await total.click()
  await expect(page.getByText('Voir 1 station', { exact: true })).toBeVisible()
})

// AdBlue is the one service tag whose absence can mean « the source never
// says ». The demo fixture declares it like the Spanish and Andorran fluxes
// do, so the chip is offered and it bites: 2 of the 6 zone stations sell it.
test('the AdBlue filter narrows the zone and survives a reload', async ({ page }) => {
  await page.getByText('Filtres · 6').click()

  const chip = page.getByRole('button', { name: 'AdBlue', exact: true })
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')

  // Only TotalEnergies · Centre and BP · Rocade Est dispense it
  await expect(page.getByText('Voir 2 stations')).toBeVisible()
  // …and the caveat about the sources that publish nothing is on screen
  await expect(page.getByText(/Les stations françaises et portugaises restent affichées/)).toBeVisible()
  await page.getByText('Voir 2 stations').click()
  await expect(page.getByText('Filtres · 2')).toBeVisible()

  await openZoneList(page)
  await expect(page.getByText('TotalEnergies · Centre').first()).toBeVisible()
  await expect(page.getByText('Station U · Croix-Blanche')).toHaveCount(0)
  await closeZoneList(page)

  // The selection is in the settings blob: landing on a bare URL, which
  // carries no filter of its own, must still come back to the same map
  // (`map-share.spec` covers the link half of the round trip)
  await page.goto('/')
  await expect(page.getByText('Filtres · 2')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Filtres · 2').click()
  await expect(page.getByRole('button', { name: 'AdBlue', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('the fiche prices AdBlue where the source declares one', async ({ page }) => {
  // Presence AND price on BP · Rocade Est, the one demo station priced the way
  // the Spanish and Andorran fluxes price theirs…
  await page.goto('/station/bp')
  await expect(page.getByText(/AdBlue\s*0,89\s*€\/L/)).toBeVisible({ timeout: 15_000 })

  // …and a bare chip where the source declares presence only
  await page.goto('/station/te')
  await expect(page.getByText('AdBlue', { exact: true })).toBeVisible({ timeout: 15_000 })
})

test('a fuel nobody sells in the zone names itself and offers what IS sold', async ({ page }) => {
  // No station within 5 km sells GPLc (the demo GPLc pumps sit farther out)
  await page.getByText('Filtres · 6').click()
  await page.getByRole('button', { name: 'GPLc', exact: true }).click()
  // French counts 0 as singular (CLDR `one`), which the hand-rolled plural
  // helper this replaced got wrong
  await expect(page.getByText('Voir 0 station', { exact: true })).toBeVisible()
  await page.getByText('Voir 0 station', { exact: true }).click()

  // The empty state must name the culprit, not look broken…
  await expect(page.getByText('Aucune station ne vend du GPLc dans cette zone.')).toBeVisible()
  await expect(page.getByText('Vendus ici :')).toBeVisible()

  // …and its chips switch straight to a fuel the zone actually sells
  await page.getByRole('button', { name: 'Gazole', exact: true }).click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
  await expect(page.getByText('Gazole ↻')).toBeVisible()
})
