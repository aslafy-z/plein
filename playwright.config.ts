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
    locale: 'en-US',
    // The app follows prefers-color-scheme unless Settings says otherwise,
    // and Playwright's default is LIGHT — pinned dark so the suite exercises
    // the same arrangement it always has. theme.spec.ts overrides it to
    // drive the resolution paths on purpose.
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The basemap is a WebGL map (MapLibre). A GPU-less runner can only
    // render it in software, at a second or so per frame — every drag in the
    // suite turned into seconds and timed out. So the suite runs WITHOUT
    // WebGL, on the raster fallback a device without it gets (src/lib/tiles.ts),
    // and e2e/tiles.spec.ts turns software WebGL back on (`WEBGL_LAUNCH` in
    // e2e/fixtures.ts) to
    // cover the vector map itself.
    launchOptions: { executablePath, args: ['--disable-3d-apis'] },
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
