import { test, expect } from './fixtures'

// A shared /station/<id> link is often someone's first contact with the app,
// so it lands on the onboarding walkthrough. The destination must survive it —
// finishing the walkthrough used to always drop the user on the map.

test.use({ seed: { sourceId: 'demo' } })

test('a station link followed before onboarding opens after it', async ({ page }) => {
  await page.goto('/station/su')
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()

  await page.getByText('Continuer sans localisation').click()

  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/station/su')
})

test('the link survives a refresh in the middle of the walkthrough', async ({ page }) => {
  await page.goto('/station/su')
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()
  await page.getByText('Continuer sans localisation').click()

  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })
})

test('a tab link followed before onboarding opens after it', async ({ page }) => {
  await page.goto('/favorites')
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()

  await page.getByText('Continuer sans localisation').click()

  await expect(page.getByText('Vos stations habituelles, au prix du jour.')).toBeVisible({
    timeout: 15_000,
  })
  expect(new URL(page.url()).pathname).toBe('/favorites')
})

test('onboarding opened on / still lands on the map', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Payez votre plein au juste prix.')).toBeVisible()

  await page.getByText('Continuer sans localisation').click()

  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
})

test('back from a fiche reached through onboarding stays in the app', async ({ page }) => {
  await page.goto('/station/su')
  await page.getByText('Continuer sans localisation').click()
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Retour' }).click()

  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
})
