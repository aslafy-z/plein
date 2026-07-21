import { test, expect } from './fixtures'

// Régression : quand un des géocodeurs du mode « Automatique » devient très
// lent (CartoCiudad a des périodes à 7 s et plus par requête), la recherche
// entière restait muette jusqu'à son timeout — l'utilisateur voyait une
// recherche morte alors que la BAN avait répondu en une seconde. Les
// suggestions doivent apparaître dès qu'une source a des résultats.
test.use({
  seed: { sourceId: 'auto', onboarded: true, lastPos: { lat: 43.6047, lng: 1.4442 } },
})

test('les suggestions n\'attendent pas la source la plus lente', async ({ page }) => {
  await page.route('**/proxy/fra/**', (route) =>
    route.fulfill({ json: { total_count: 0, results: [] } }),
  )
  await page.route('**/brands-fra.json', (route) =>
    route.fulfill({ json: { v: 1, labels: [], pois: [] } }),
  )
  await page.route('**/proxy/ban/**', (route) =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [
          {
            geometry: { coordinates: [1.4442, 43.6047] },
            properties: { label: 'Toulouse', context: '31, Haute-Garonne, Occitanie' },
          },
        ],
      },
    }),
  )
  await page.route('**/proxy/and/**', (route) => route.fulfill({ json: { suggestions: [] } }))
  // CartoCiudad en pleine léthargie : rien avant 20 s.
  await page.route('**/proxy/cartociudad/**', async (route) => {
    await new Promise((r) => setTimeout(r, 20_000))
    await route.fulfill({ json: [] }).catch(() => {})
  })

  await page.goto('/')
  await expect(page.getByLabel('Rechercher un lieu')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('Rechercher un lieu').click()
  await page.getByPlaceholder('Ville, adresse…').fill('Toulouse')

  // BAN répond tout de suite ; la grâce accordée aux retardataires est de
  // 1,5 s — les suggestions doivent tomber bien avant les 20 s espagnoles.
  await expect(page.getByText('voir les stations ici').first()).toBeVisible({ timeout: 6_000 })
})
