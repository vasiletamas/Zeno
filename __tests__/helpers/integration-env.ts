import 'dotenv/config'

// Single-client rule (plan "How to execute" #6): the integration ring points
// DATABASE_URL at the test database BEFORE '@/lib/db' is imported, so the
// tests and the code under test share one client and one URL — no split brain.
// With a dedicated TEST_DATABASE_URL it wins; without one, the two names are
// aliased to the same database.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
} else {
  process.env.TEST_DATABASE_URL = process.env.DATABASE_URL
}
