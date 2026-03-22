import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/scenarios/**/*.test.ts'],
    testTimeout: 120000, // 2 min per test
    hookTimeout: 30000, // 30s for setup/teardown hooks
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
