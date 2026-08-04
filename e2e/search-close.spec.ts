import { test, expect, gotoMap, desktopOnly } from './fixtures'

// The open place search closes without hunting for a target: Escape closes it,
// its own button closes it, and on a window a click anywhere else closes it
// too, like the filters. The ✕ used to be the only way out, which neither a
// keyboard nor a misclick ever found.

async function openSearch(page: import('@playwright/test').Page) {
  await gotoMap(page)
  await page.getByLabel('Search for a place').click()
  await expect(page.getByPlaceholder('Town, address…')).toBeFocused()
}

test('Escape closes the search', async ({ page }) => {
  await openSearch(page)
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Town, address…')).toHaveCount(0)
  await expect(page.getByLabel('Search for a place')).toBeVisible()
})

// The ✕ of the desktop dropdown, the ← of the phone's full-screen search
test('the close button closes the search', async ({ page }) => {
  await openSearch(page)
  await page.getByRole('button', { name: 'Close the search' }).click()
  await expect(page.getByPlaceholder('Town, address…')).toHaveCount(0)
  await expect(page.getByLabel('Search for a place')).toBeVisible()
})

// Opening the search stacks a history entry: on a phone it is a screen of its
// own, and the system Back is how a screen is left. Closing it from the UI
// pops that entry back, so Back never has to walk a closed search.
test('the system back button closes the search', async ({ page }) => {
  await openSearch(page)
  await page.goBack()
  await expect(page.getByPlaceholder('Town, address…')).toHaveCount(0)
  await expect(page.getByText('The cheapest near you')).toBeVisible()
})

test.describe('window', () => {
  desktopOnly('a dropdown has an outside — the phone search covers the screen')

  test('a click outside closes the search', async ({ page }) => {
    await openSearch(page)
    // exact: the desktop rail's logo is « Plein. — back to the map »
    await page.getByRole('button', { name: 'Back to the map', exact: true }).click()
    await expect(page.getByPlaceholder('Town, address…')).toHaveCount(0)
  })
})

test('the focus ring wraps the box, and password managers stay away', async ({ page }) => {
  await openSearch(page)
  const input = page.getByPlaceholder('Town, address…')

  // A focused text input always matches :focus-visible — the ring must land
  // on the rounded box around it, never on the bare input.
  expect(await input.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
  expect(
    await input.evaluate((el) => getComputedStyle(el.closest('.search-box')!).outlineStyle),
  ).toBe('solid')

  // A place is not a login: the field opts out of autofill overlays.
  await expect(input).toHaveAttribute('autocomplete', 'off')
  await expect(input).toHaveAttribute('data-1p-ignore', /.*/)
})
