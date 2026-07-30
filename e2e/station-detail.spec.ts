import { test, expect, gotoMap, phoneOnly } from './fixtures'

// The demo card recommends Station U · Croix-Blanche (cheapest effective
// price of the zone), whose fiche is fully deterministic: five priced fuels,
// all at the zone's lowest, réservoir 50 L, zone max (gazole) = 1,82 €.
// The comparison/tier math itself is unit-tested — this checks the fiche
// actually renders it.

test('the fiche shows every fuel, its rank in the zone and the savings math', async ({ page }) => {
  await gotoMap(page)
  await page.getByText(/MàJ /).first().click()

  // Identity: name, address line, 24/24 badge, brand chip
  await expect(page.getByText('12 route de la Croix-Blanche · 31000 Toulouse')).toBeVisible()
  await expect(page.getByText('Ouvert 24/24').first()).toBeVisible()
  await expect(page.getByText('Système U')).toBeVisible()

  // Prices card: the five priced fuels are all the zone's lowest
  await expect(page.getByText('▼ le + bas dans le rayon')).toHaveCount(5)
  await expect(page.getByText('1,67 €').first()).toBeVisible() // gazole
  await expect(page.getByText('0,84 €')).toBeVisible() // E85

  // Demo data is labelled as such on the fiche — never fake social proof
  await expect(page.getByText(/données de démonstration/)).toBeVisible()

  // Savings on a full tank vs the priciest of the radius:
  // (1,82 − 1,67) × 50 L = 7,50 €
  await expect(page.getByText('−7,50 €')).toBeVisible()
  await expect(page.getByText('sur un plein de 50 L vs la plus chère dans le rayon')).toBeVisible()

  // Raw service labels, beyond the normalized filter tags
  await expect(page.getByText('Gonflage')).toBeVisible()
  await expect(page.getByText('Lavage')).toBeVisible()
})

// The mini-map only exists on the phone fiche — the desktop one stacks over
// the live map, which already shows the station's pin
test.describe('mini-map pin', () => {
  phoneOnly('the desktop fiche has no mini-map')

  test('the fiche pin wears the enseigne logo, initials only without one', async ({ page }) => {
    await page.goto('/station/su')
    await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

    const pin = page.locator('[aria-label="Carte de la station"] .pin-bubble')
    await expect(pin).toHaveCount(1)
    await expect(pin.locator('div')).toHaveCSS('background-image', /brand-icons\/u\.png/)

    // Garage Morel is independent: no logo to show, so the initials stay
    await page.goto('/station/mo')
    await expect(page.getByText('Garage Morel')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[aria-label="Carte de la station"] .pin-bubble')).toHaveText('GM')
  })
})
