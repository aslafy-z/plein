import { defineConfig } from 'vitest/config'

// Standalone config so unit tests skip vite.config.ts entirely (its
// Cloudflare plugin spawns workerd — pointless for pure-function tests).
export default defineConfig({
  define: {
    // Injected by the build; referenced by src/lib/appUpdate.ts
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Without this vitest stubs every CSS import with an empty string, and
    // src/fonts.test.ts asserts on the real text of src/styles.css.
    css: true,
  },
})
