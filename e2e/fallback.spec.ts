import { test, expect } from './fixtures'

// When the real source is down (every gouv request aborted here — no network
// luck involved, unlike sources.spec.ts), the app must substitute the demo
// dataset VISIBLY: banner on the map, warning in Réglages, working stations.

test.use({ seed: { sourceId: 'fra', onboarded: true } })

test('a dead gouv source falls back to demo data with a visible banner', async ({ page }) => {
  await page.route('**/proxy/fra/**', (route) => route.abort())
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )

  await page.goto('/')

  // The banner owns up to the substitution and offers a retry
  await expect(
    page.getByText('Source temps réel indisponible — données de démonstration affichées.'),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible()

  // The map still works, on the demo stations around the default position
  await expect(page.getByText('La moins chère près de vous')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('1,67 €').first()).toBeVisible()

  // Réglages repeats the warning next to the source list
  await page.getByText('Réglages', { exact: true }).click()
  await expect(page.getByText(/bascule automatique sur la démo/)).toBeVisible()
})
