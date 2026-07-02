import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Load .env into process.env (plain vitest does not): required so the
    // real-DB integration ring sees DATABASE_URL instead of silently skipping.
    setupFiles: ['dotenv/config'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['__tests__/**/*.test.ts'],
          exclude: [...configDefaults.exclude, '__tests__/integration/**'],
        },
      },
      {
        // Real-DB integration ring: these suites TRUNCATE the same tables via
        // the shared test-db helper, so their files must NEVER run in parallel.
        // Canonical commands:
        //   npx vitest run --project integration        (whole ring)
        //   npx vitest run __tests__/integration/<file>  (single file)
        // `npx vitest run` (full suite) also serializes this ring via this project.
        extends: true,
        test: {
          name: 'integration',
          include: ['__tests__/integration/**/*.test.ts'],
          fileParallelism: false,
          // Loads .env AND aliases DATABASE_URL <-> TEST_DATABASE_URL before
          // any test imports '@/lib/db' (single-client rule, A2.ADD-1).
          setupFiles: ['./__tests__/helpers/integration-env.ts'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
