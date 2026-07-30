import { test, expect, gotoMap } from './fixtures'

// The open place search is a popover: Escape closes it and a click anywhere
// else closes it too, like the filters. The ✕ used to be the only way out,
// which neither a keyboard nor a misclick ever found.

async function openSearch(page: import('@playwright/test').Page) {
  await gotoMap(page)
  await page.getByLabel('Rechercher un lieu').click()
  await expect(page.getByPlaceholder('Ville, adresse…')).toBeFocused()
}

test('Escape closes the search', async ({ page }) => {
  await openSearch(page)
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Ville, adresse…')).toHaveCount(0)
  await expect(page.getByLabel('Rechercher un lieu')).toBeVisible()
})

test('a click outside closes the search', async ({ page }) => {
  await openSearch(page)
  // exact: the desktop rail's logo is « Plein. — revenir à la carte »
  await page.getByRole('button', { name: 'Revenir à la carte', exact: true }).click()
  await expect(page.getByPlaceholder('Ville, adresse…')).toHaveCount(0)
})

test('the focus ring wraps the box, and password managers stay away', async ({ page }) => {
  await openSearch(page)
  const input = page.getByPlaceholder('Ville, adresse…')

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
