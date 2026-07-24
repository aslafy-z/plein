import { test, expect } from './fixtures'

// Sharing a fiche: the native sheet where the browser has one, the clipboard
// everywhere else. Playwright's Chromium implements neither `navigator.share`
// nor a share sheet, so both paths are stubbed before boot.

/** Records what the page hands to navigator.share */
async function stubShare(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { shared: unknown[] }).shared = []
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: unknown) => {
        ;(window as unknown as { shared: unknown[] }).shared.push(data)
        return Promise.resolve()
      },
    })
  })
}

test('the share button hands the fiche deep link to the native sheet', async ({ page }) => {
  await stubShare(page)
  await page.goto('/station/su')
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Partager la station' }).click()

  const shared = await page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)
  expect(shared).toHaveLength(1)
  const data = shared[0] as { title: string; text: string; url: string }
  expect(data.url).toBe(`${new URL(page.url()).origin}/station/su`)
  expect(data.title).toBe('Plein. — Station U · Croix-Blanche')
  expect(data.text).toContain('Gazole à 1,67 €/L')
})

test('a dismissed share sheet leaves the fiche alone', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
    })
  })
  await page.goto('/station/su')
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Partager la station' }).click()

  // No toast, no navigation: the user simply changed their mind
  await expect(page.getByText('Lien copié')).toHaveCount(0)
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible()
})

test('without the Web Share API the link goes to the clipboard', async ({ page }) => {
  await page.addInitScript(() => {
    // Chromium ships no navigator.share; make the absence explicit anyway
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    ;(window as unknown as { copied: string[] }).copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          ;(window as unknown as { copied: string[] }).copied.push(t)
          return Promise.resolve()
        },
      },
    })
  })
  await page.goto('/station/su')
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Partager la station' }).click()

  await expect(page.getByText('Lien copié')).toBeVisible()
  const copied = await page.evaluate(() => (window as unknown as { copied: string[] }).copied)
  expect(copied).toEqual([`${new URL(page.url()).origin}/station/su`])
})
