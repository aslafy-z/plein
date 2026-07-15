import { test, expect } from './fixtures'

test.use({ seed: { sourceId: 'demo' } })

test('onboarding leads to a live map without location', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()

  await page.getByText('Continuer sans localisation').click()

  await expect(page.getByText('Chercher un lieu ou un trajet…')).toBeVisible()
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
})
