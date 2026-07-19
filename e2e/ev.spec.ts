import { test, expect } from './fixtures'

// EV mode: the map compares charge prices (€/kWh) from the demo bornes set —
// pins, card, list, filters and detail all switch to the charge domain.
test.use({ seed: { sourceId: 'demo', onboarded: true, mode: 'ev' } })

test('EV mode shows the cheapest borne card with a €/kWh price', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  // The demo set's cheapest is the free Carmes station
  await expect(page.getByText('Parking Carmes · Recharge').first()).toBeVisible()
  await expect(page.getByText('gratuit', { exact: true }).first()).toBeVisible()
  // The chips reflect the EV mode: power cycle + fuel-mode toggle
  await expect(page.getByRole('button', { name: 'Puissance ↻' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Passer aux carburants' })).toBeVisible()
})

test('power chip cycles the minimum power and filters the bornes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Puissance ↻' }).click()
  await expect(page.getByText('≥ 7 kW ↻')).toBeVisible()
  await page.getByText('≥ 7 kW ↻').click()
  await expect(page.getByText('≥ 50 kW ↻')).toBeVisible()
  await page.getByText('≥ 50 kW ↻').click()
  // ≥ 150 kW → only the fast networks remain; cheapest becomes Tesla (0,40)
  await expect(page.getByText('≥ 150 kW ↻')).toBeVisible()
  await expect(page.getByText('Superchargeur · Toulouse Nord').first()).toBeVisible()
})

test('filters sheet shows the EV sections and applies connector filters', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await page.getByText(/^Filtres · \d+$/).click()
  await expect(page.getByText('Connecteurs', { exact: true })).toBeVisible()
  await expect(page.getByText('Puissance minimale')).toBeVisible()
  // Fuel-only sections stay hidden in EV mode
  await expect(page.getByText('Marques')).toHaveCount(0)
  await page.getByText('Combo CCS', { exact: true }).click()
  await page.getByText(/^Voir \d+ bornes?$/).click()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible()
})

test('borne detail shows price provenance and charge points', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^PC Parking Carmes/ }).click()
  await expect(page.getByText('Recharge gratuite')).toBeVisible()
  await expect(page.getByText('Points de charge').first()).toBeVisible()
  await expect(page.getByText('Type 2 × 6')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Y aller' })).toBeVisible()
})

test('Réglages : la motorisation bascule le mode et montre les réglages batterie', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Réglages' }).click()
  // Seeded in EV mode → the électrique chip is active, battery sliders shown
  await expect(page.getByText('Motorisation')).toBeVisible()
  await expect(page.getByText('Batterie')).toBeVisible()
  await expect(page.getByText('55 kWh')).toBeVisible()
  await expect(page.getByText('kWh/100 km')).toBeVisible()
  // Thermal-only controls stay hidden in EV mode
  await expect(page.getByText('Carburant par défaut')).toHaveCount(0)
  await expect(page.getByText('Réservoir')).toHaveCount(0)
  // Switching back to thermique restores them and the map follows
  await page.getByRole('button', { name: '⛽ Thermique' }).click()
  await expect(page.getByText('Carburant par défaut')).toBeVisible()
  await page.getByRole('button', { name: 'Carte' }).click()
  await expect(page.getByText('Gazole ↻')).toBeVisible()
})

test('mode toggle returns to fuel prices and back', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Passer aux carburants' }).click()
  await expect(page.getByText('Gazole ↻')).toBeVisible()
  await expect(page.getByText(/ \/ L$/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Passer à la recharge électrique' }).click()
  await expect(page.getByRole('button', { name: 'Puissance ↻' })).toBeVisible()
})
