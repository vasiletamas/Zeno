import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/scenarios/**/*.test.ts'],
    // Full-funnel scenarios drive 30+ live LLM turns at ~10s each — the
    // legacy 2-minute budget predates the tool-loop turn structure.
    testTimeout: 900000, // 15 min per scenario
    hookTimeout: 30000, // 30s for setup/teardown hooks
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
