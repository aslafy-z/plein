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
  },
})
