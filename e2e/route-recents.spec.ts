import { test, expect, gotoMap } from './fixtures'

// A departure the user names is a place they looked up, so it lands in
// « Récents » alongside the destination — and a recent row then fills whichever
// field is being edited.

test('a named departure enters the recents, which fill either field', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Trajet', { exact: true }).click()

  const departure = page.locator('input[placeholder="Départ"]')
  const destination = page.locator('input[placeholder="Destination"]')

  // ── A trip Bordeaux → Montpellier, neither end being the user's position ──
  await departure.fill('Bordeaux')
  await page.getByText('Bordeaux centre').click()
  await expect(departure).toHaveValue('Bordeaux centre')

  await destination.fill('Montpellier')
  await page.getByText('Montpellier').click()
  await page.getByText('Comparer les stations sur le trajet').click()
  // The ribbon: this corridor runs outside the demo dataset, so what matters
  // here is the trip being computed, not the stops it finds.
  const edit = page.getByRole('button', { name: 'Modifier' })
  await expect(edit).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Bordeaux centre → Montpellier')).toBeVisible()

  // ── Both ends are remembered, destination first ──
  await edit.click()
  await expect(page.getByText('Récents', { exact: true })).toBeVisible()
  const recents = page.locator('button:has-text("fait le")')
  await expect(recents.first()).toContainText('Montpellier')
  await expect(recents.nth(1)).toContainText('Bordeaux centre')

  // ── A recent fills the field being edited: the departure here ──
  await departure.click()
  await recents.first().click()
  await expect(departure).toHaveValue('Montpellier')

  // ── …and the destination when that is where the screen left off ──
  await destination.click()
  await recents.nth(1).click()
  await expect(destination).toHaveValue('Bordeaux centre')
})
