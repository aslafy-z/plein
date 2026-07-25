import { test, expect, gotoMap } from './fixtures'

// Sharing a fiche — or the map view itself: the system sheet wherever the browser has one, the
// clipboard everywhere else. Playwright's Chromium implements neither
// `navigator.share` nor a share sheet, so both sides are stubbed before boot.

/** Records what the page hands to navigator.share, and what it copies */
async function stubSharing(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { shared: unknown[]; copied: string[] }
    w.shared = []
    w.copied = []
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: unknown) => {
        w.shared.push(data)
        return Promise.resolve()
      },
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          w.copied.push(t)
          return Promise.resolve()
        },
      },
    })
  })
}

const shared = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)
const copied = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { copied: string[] }).copied)

async function openFiche(page: import('@playwright/test').Page) {
  await page.goto('/station/su')
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible({ timeout: 15_000 })
}

/**
 * The fiche is a full-screen overlay: a toast painted under it is "visible" to
 * Playwright while being invisible to the user. Hit-test the middle of the
 * toast instead — it must be the element the click would land on.
 */
async function expectToastOnTop(page: import('@playwright/test').Page, text: string) {
  const toast = page.getByRole('status').filter({ hasText: text })
  await expect(toast).toBeVisible()
  const onTop = await toast.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return el.contains(hit)
  })
  expect(onTop, 'the toast must not be painted under the fiche').toBe(true)
}

test('the share button hands the fiche deep link to the native sheet', async ({ page }) => {
  await stubSharing(page)
  await openFiche(page)

  await page.getByRole('button', { name: 'Partager la station' }).click()

  const sheet = await shared(page)
  expect(sheet).toHaveLength(1)
  const data = sheet[0] as { title: string; text: string; url: string }
  expect(data.url).toBe(`${new URL(page.url()).origin}/station/su`)
  expect(data.title).toBe('Plein. — Station U · Croix-Blanche')
  expect(data.text).toContain('Gazole à 1,67 €/L')
  // The sheet carries the link; nothing is copied behind the user's back
  expect(await copied(page)).toEqual([])
})

test('a dismissed share sheet leaves the fiche alone', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
    })
  })
  await openFiche(page)

  await page.getByRole('button', { name: 'Partager la station' }).click()

  // No toast, no navigation: the user simply changed their mind
  await expect(page.getByText('Lien copié')).toHaveCount(0)
  await expect(page.getByText('Station U · Croix-Blanche')).toBeVisible()
})

test('without the Web Share API the link goes to the clipboard', async ({ page }) => {
  await stubSharing(page)
  await page.addInitScript(() => {
    // Chrome on Linux and Firefox ship no navigator.share
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })
  await openFiche(page)

  await page.getByRole('button', { name: 'Partager la station' }).click()

  // The toast is the only feedback there is — it must clear the fiche overlay
  await expectToastOnTop(page, 'Lien copié')
  expect(await copied(page)).toEqual([`${new URL(page.url()).origin}/station/su`])
})

test('with neither API the button says so instead of failing silently', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })
  await openFiche(page)

  await page.getByRole('button', { name: 'Partager la station' }).click()

  await expectToastOnTop(page, 'Partage indisponible sur cet appareil')
})

test('the map share button hands the current view to the native sheet', async ({ page }) => {
  await stubSharing(page)
  await gotoMap(page)
  await page.waitForTimeout(700) // let the throttled URL write settle

  await page.getByRole('button', { name: 'Partager cette vue' }).click()

  const sheet = await shared(page)
  expect(sheet).toHaveLength(1)
  const data = sheet[0] as { title: string; text: string; url: string }
  // The link is the very one the address bar carries
  expect(data.url).toBe(page.url())
  expect(data.url).toContain('f=diesel')
  expect(data.title).toBe('Plein. — Gazole dans cette zone')
  expect(await copied(page)).toEqual([])
})

test('without the Web Share API the map link goes to the clipboard', async ({ page }) => {
  await stubSharing(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  })
  await gotoMap(page)
  await page.waitForTimeout(700) // let the throttled URL write settle

  await page.getByRole('button', { name: 'Partager cette vue' }).click()

  await expect(page.getByRole('status').filter({ hasText: 'Lien copié' })).toBeVisible()
  expect(await copied(page)).toEqual([page.url()])
})
