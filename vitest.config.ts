import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// Standalone config so unit tests skip vite.config.ts entirely (its
// Cloudflare plugin spawns workerd — pointless for pure-function tests).
export default defineConfig({
  define: {
    // Injected by the build; referenced by src/lib/appUpdate.ts
    __APP_VERSION__: JSON.stringify('test'),
    // Same normalization as vite.config.ts, package.json staying the one source
    __REPO_URL__: JSON.stringify(
      (
        (
          JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
            repository?: { url?: string }
          }
        ).repository?.url ?? ''
      )
        .replace(/^git\+/, '')
        .replace(/\.git$/, ''),
    ),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Without this vitest stubs every CSS import with an empty string, and
    // src/fonts.test.ts asserts on the real text of src/styles.css.
    css: true,
  },
})
