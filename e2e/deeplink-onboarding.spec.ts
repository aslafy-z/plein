import { test, expect } from './fixtures'

// A shared /station/<id> link is often someone's first contact with the app,
// so it lands on the onboarding walkthrough. The destination must survive it —
// finishing the walkthrough used to always drop the user on the map.

test.use({ seed: { sourceId: 'demo' } })

test('a station link followed before onboarding opens after it', async ({ page }) => {
  await page.goto('/station/su')
  await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

  await page.getByText('Continue without location').click()

  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/station/su')
})

test('the link survives a refresh in the middle of the walkthrough', async ({ page }) => {
  await page.goto('/station/su')
  await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

  await page.reload()
  await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()
  await page.getByText('Continue without location').click()

  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible({ timeout: 15_000 })
})

test('a tab link followed before onboarding opens after it', async ({ page }) => {
  await page.goto('/favorites')
  await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

  await page.getByText('Continue without location').click()

  await expect(page.getByText("The stations you use, at today's price.")).toBeVisible({
    timeout: 15_000,
  })
  expect(new URL(page.url()).pathname).toBe('/favorites')
})

test('onboarding opened on / still lands on the map', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Pay a fair price at the pump.')).toBeVisible()

  await page.getByText('Continue without location').click()

  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
})

test('back from a fiche reached through onboarding stays in the app', async ({ page }) => {
  await page.goto('/station/su')
  await page.getByText('Continue without location').click()
  await expect(page.getByText('Station U · Croix-Blanche').first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: /^(Back|Close the station page)$/ }).click()

  await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
  expect(new URL(page.url()).pathname).toBe('/')
})
