import { test, expect, gotoMap } from './fixtures'

// The What's new log (src/lib/changelog.ts). Every other spec seeds it as
// read; here the mark is dropped, which is what a blob written before the log
// existed looks like — a returning user.
const sparkle = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: "See what's new" })
const sheet = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: "What's new" })
// The newest entry, and one from the history behind it (en.json copy)
const LATEST = "Your color, and a what's new log"
const EARLIER = '« My position » as a destination'

test.describe('a returning user', () => {
  test.use({ seed: { sourceId: 'demo', onboarded: true, changelogSeen: null } })

  test('gets a quiet sparkle on the map, reads the news through it, and keeps no sparkle', async ({
    page,
  }) => {
    await gotoMap(page)
    // Nothing interrupts the map: no dialog until the user asks for one
    await expect(sparkle(page)).toBeVisible()
    await expect(sheet(page)).toHaveCount(0)

    await sparkle(page).click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByText('New', { exact: true })).toBeVisible()
    // Opening the sheet is reading the news: the sparkle is gone behind it
    await expect(sparkle(page)).toHaveCount(0)

    // The news leads; the history waits one tap away, unrolled in place
    await expect(sheet(page).getByRole('heading', { name: LATEST })).toBeVisible()
    await expect(sheet(page).getByRole('heading', { name: EARLIER })).toHaveCount(0)
    // The short entry links the long version: its release page
    await expect(sheet(page).getByRole('button', { name: 'Full release notes' })).toBeVisible()
    await sheet(page).getByRole('button', { name: 'See earlier changes' }).click()
    await expect(sheet(page).getByRole('heading', { name: EARLIER })).toBeVisible()
    await expect(sheet(page).getByRole('button', { name: 'See earlier changes' })).toHaveCount(0)

    await sheet(page).getByRole('button', { name: 'Got it' }).click()
    await expect(sheet(page)).toHaveCount(0)

    await page.reload()
    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
    await expect(sparkle(page)).toHaveCount(0)
  })
})

test('Settings reopens the log, and Back closes it without leaving the screen', async ({
  page,
}) => {
  await gotoMap(page)
  await expect(sparkle(page)).toHaveCount(0)
  await page.getByText('Settings', { exact: true }).click()

  await page.getByRole('button', { name: /What's new/ }).click()
  await expect(sheet(page)).toBeVisible()
  // Nothing was announced this session: no entry is flagged, and the whole
  // history is open at once — nothing to unroll
  await expect(sheet(page).getByText('New', { exact: true })).toHaveCount(0)
  await expect(sheet(page).getByRole('heading', { name: LATEST })).toBeVisible()
  await expect(sheet(page).getByRole('heading', { name: EARLIER })).toBeAttached()
  await expect(sheet(page).getByRole('button', { name: 'See earlier changes' })).toHaveCount(0)

  await page.goBack()
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.getByText('Default fuel')).toBeVisible()
})

test.describe('a newcomer', () => {
  test.use({ seed: { sourceId: 'demo', changelogSeen: null } })

  test('is never told about the app they just met', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Continue without location').click()
    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
    await expect(sparkle(page)).toHaveCount(0)

    await page.reload()
    await expect(page.getByText('The cheapest near you')).toBeVisible({ timeout: 15_000 })
    await expect(sparkle(page)).toHaveCount(0)
  })
})
