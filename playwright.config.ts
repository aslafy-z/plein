import { defineConfig, devices } from '@playwright/test'

// Sandboxed environments can point PLEIN_CHROMIUM at a system Chromium when
// the pinned Playwright browser build is absent (e.g. PLEIN_CHROMIUM=$(which chromium)).
const executablePath = process.env.PLEIN_CHROMIUM || undefined

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'fr-FR',
    // The app follows prefers-color-scheme unless Réglages says otherwise,
    // and Playwright's default is LIGHT — pinned dark so the suite exercises
    // the same arrangement it always has. theme.spec.ts overrides it to
    // drive the resolution paths on purpose.
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
