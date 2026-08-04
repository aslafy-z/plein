import { test, expect, gotoMap, openRouteSheet, pickRoutePlace } from './fixtures'

// The route screen mirrors the trip into the query string the way the map
// mirrors its view (map-share.spec.ts): the address bar is always a link to
// the trip on screen, opening such a link recomputes the same route under the
// same assumptions, and a reload on the ribbon returns to the ribbon. The
// serialization itself is covered unit-side (src/lib/routeUrl.test.ts).

const params = (page: import('@playwright/test').Page) => new URL(page.url()).searchParams

/** Endpoint field content, whatever the arrangement: an input on a window, a
    trigger button (showing its value as text) on a phone. The two arrangements
    name the departure differently: « From » as the input placeholder,
    « Departure » as the phone trigger. */
async function expectFieldValue(
  page: import('@playwright/test').Page,
  name: 'From' | 'Destination',
  value: string,
) {
  const input = page.getByPlaceholder(name)
  if ((await input.count()) > 0) await expect(input).toHaveValue(value)
  else {
    const trigger = name === 'From' ? 'Departure' : 'Destination'
    await expect(page.getByRole('button', { name: trigger, exact: true })).toContainText(value)
  }
}

test('the ribbon writes the trip into the URL, keeps up with the strategy, and survives a reload', async ({
  page,
}) => {
  test.slow() // a route compute, a strategy switch and a second full boot
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()
  await pickRoutePlace(page, 'to', 'Bordeaux', 'Bordeaux centre')
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })

  // The computed ribbon owns its own path, and the query describes the trip
  await expect.poll(() => new URL(page.url()).pathname).toBe('/route/results')
  expect(params(page).get('d')).toBe('44.8378,-0.5792')
  expect(params(page).get('dl')).toBe('Bordeaux centre')
  expect(params(page).get('f')).toBe('diesel')
  expect(params(page).get('m')).toBe('balanced')
  expect(params(page).get('v')).toBe('car')
  // A « My position » departure never writes where the sender was
  expect(params(page).get('a')).toBeNull()
  expect(params(page).get('al')).toBeNull()

  // The strategy toggle is visible in the URL
  await openRouteSheet(page)
  await page.getByText('Lowest price').click()
  await expect.poll(() => params(page).get('m')).toBe('price')

  // F5 on the ribbon returns to the ribbon — same trip, same strategy
  await page.reload()
  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
  expect(new URL(page.url()).pathname).toBe('/route/results')
  await expect.poll(() => params(page).get('m')).toBe('price')
})

test('a shared trip link reopens the same trip, without touching the reader profile', async ({
  page,
}) => {
  await page.goto(
    '/route/results?a=43.6047,1.4442&al=Capitole&d=44.8378,-0.5792&dl=Bordeaux%20centre' +
      '&f=diesel&m=price&v=car&t=60&c=7&tp=50',
  )

  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
  await openRouteSheet(page)
  // The endpoints the link named, and ITS tank — not the reader's 50 L default
  await expect(page.getByText('Capitole → Bordeaux centre')).toBeVisible()
  await expect(page.getByText(/60 L tank/)).toBeVisible()

  // The link's vehicle assumptions are never written back to the profile
  const persistedTank = await page.evaluate(
    () => JSON.parse(localStorage.getItem('plein.settings.v1') ?? '{}').tank,
  )
  expect(persistedTank).toBeUndefined()
})

test('a link carrying labels but no coordinates geocodes on open', async ({ page }) => {
  await page.goto('/route/results?dl=Bordeaux%20centre&f=diesel')

  await expect(page.getByText('No fuel stop needed').first()).toBeVisible({
    timeout: 30_000,
  })
  // Once resolved, the address bar carries the coordinates a re-share needs
  await expect.poll(() => params(page).get('d')).toBe('44.8378,-0.5792')
})

test('a destination-only link opens the setup form pre-filled, departure on « My position »', async ({
  page,
}) => {
  await page.goto('/route?d=44.8378,-0.5792&dl=Bordeaux%20centre')

  await expect(
    page.getByRole('button', { name: 'Compare the stations along the route' }),
  ).toBeVisible({ timeout: 15_000 })
  await expectFieldValue(page, 'Destination', 'Bordeaux centre')
  await expectFieldValue(page, 'From', 'My position')
  expect(new URL(page.url()).pathname).toBe('/route')
})

test('a hand-edited link degrades to the setup form instead of breaking', async ({ page }) => {
  // Nothing usable: coordinates off Earth, an empty label, unknown ids — the
  // fixture also fails this test on any console error.
  await page.goto('/route/results?a=91,999&d=nord,ouest&dl=&f=kerosene&t=abc&m=fastest')

  await expect(
    page.getByRole('button', { name: 'Compare the stations along the route' }),
  ).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => new URL(page.url()).pathname).toBe('/route')
})
