import 'dotenv/config'

/**
 * Test-run safety rail (2026-07-21, Resend merge): once a developer sets
 * EMAIL_PROVIDER=resend in .env for live OTP delivery, every subsequent test
 * run would send REAL email — the verification suites alone issue dozens of
 * challenges. Worse, the sends bill the account and fail the tests when the
 * API key is absent or rate-limited, which reads as a code regression.
 *
 * Tests always run on the mock provider. A suite that genuinely wants to
 * exercise the Resend path sets process.env.EMAIL_PROVIDER inside the test
 * (provider-resolution.test.ts does exactly that, with vi.resetModules).
 */
process.env.EMAIL_PROVIDER = 'mock'
