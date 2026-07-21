import { test, expect, gotoMap } from './fixtures'

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
  await expect(page.getByText('1,67 €')).toBeVisible() // gazole
  await expect(page.getByText('0,84 €')).toBeVisible() // E85

  // Community trust line (demo source exposes confirmations)
  await expect(page.getByText(/confirmé par 12 conducteurs/)).toBeVisible()

  // Savings on a full tank vs the priciest of the radius:
  // (1,82 − 1,67) × 50 L = 7,50 €
  await expect(page.getByText('−7,50 €')).toBeVisible()
  await expect(page.getByText('sur un plein de 50 L vs la plus chère dans le rayon')).toBeVisible()

  // Raw service labels, beyond the normalized filter tags
  await expect(page.getByText('Gonflage')).toBeVisible()
  await expect(page.getByText('Lavage')).toBeVisible()
})
