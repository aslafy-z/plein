import { test, expect, gotoMap, pickRoutePlace } from './fixtures'

// Where the user stands is a place their own search offers: both endpoint
// fields carry a « My position » row, and only ONE end may hold it — a trip
// from here to here is not a trip. The offer needs a position the app really
// has: the runner's Chromium never answers a fix, so the last known one is
// seeded (geolocation-unknown.spec.ts covers the no-position side).
const TOULOUSE = { lat: 43.6047, lng: 1.4442 }

test.use({ seed: { sourceId: 'demo', onboarded: true, lastFix: TOULOUSE } })

/** The offered row, in whichever container the arrangement opened */
const positionRow = (page: import('@playwright/test').Page) =>
  page.getByTestId('search-suggestions').getByText('My position')

/** Placeholder of the input, aria-label of the phone's trigger button */
const NAMES = {
  from: { placeholder: 'From', trigger: 'Departure' },
  to: { placeholder: 'Destination', trigger: 'Destination' },
} as const

/** Open an endpoint's search WITHOUT typing: a dropdown under a focused input
    on a window, the full-screen panel on a phone. */
async function openField(page: import('@playwright/test').Page, field: 'from' | 'to') {
  const { placeholder, trigger } = NAMES[field]
  const input = page.getByPlaceholder(placeholder)
  if ((await input.count()) === 0) {
    await page.getByRole('button', { name: trigger, exact: true }).click()
    await expect(input).toBeVisible()
  } else {
    await input.click()
  }
}

async function closeField(page: import('@playwright/test').Page) {
  const back = page.getByRole('button', { name: 'Close the search' })
  if ((await back.count()) > 0) await back.click()
  else await page.keyboard.press('Escape')
}

/** Endpoint field content, whatever the arrangement */
async function expectFieldValue(
  page: import('@playwright/test').Page,
  field: 'from' | 'to',
  value: string,
) {
  const { placeholder, trigger } = NAMES[field]
  const input = page.getByPlaceholder(placeholder)
  if ((await input.count()) > 0) await expect(input).toHaveValue(value)
  else await expect(page.getByRole('button', { name: trigger, exact: true })).toContainText(value)
}

test('the position is offered to one end at a time, and taken by either', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  // The departure already means « wherever I am » — offering it again, to
  // either field, would build a trip from here to here
  await openField(page, 'to')
  await expect(positionRow(page)).toHaveCount(0)
  await closeField(page)
  await openField(page, 'from')
  await expect(positionRow(page)).toHaveCount(0)
  await closeField(page)

  // Name a departure and the offer moves to the destination
  await pickRoutePlace(page, 'from', 'Bordeaux', 'Bordeaux centre')
  await expectFieldValue(page, 'from', 'Bordeaux centre')
  await openField(page, 'to')
  await positionRow(page).click()

  // Picking it IS the submit, like picking any destination: the trip stands,
  // and the field says where it goes
  await expectFieldValue(page, 'to', 'My position')
  await expect(
    page.getByText(/No fuel stop needed|Recommended stop|Not enough range/).first(),
  ).toBeVisible({ timeout: 30_000 })

  // …and now the destination holds it, so the departure may not take it back
  await openField(page, 'from')
  await expect(positionRow(page)).toHaveCount(0)
})

test('a departure named by hand can be put back on the position', async ({ page }) => {
  await gotoMap(page)
  await page.getByText('Route', { exact: true }).click()

  await pickRoutePlace(page, 'from', 'Bordeaux', 'Bordeaux centre')
  await openField(page, 'from')
  await positionRow(page).click()
  await expectFieldValue(page, 'from', 'My position')
})
