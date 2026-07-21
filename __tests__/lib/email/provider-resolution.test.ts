/**
 * EMAIL_PROVIDER resolution (2026-07-21, Resend merge). The resend branch is
 * selected through a lazy `require()` inside an ESM module — a resolution path
 * that differs per runtime (vitest/ESM, Next server, Turbopack). A silent
 * failure here means verification codes stop being delivered in production
 * while every other test stays green, so the selection itself is pinned.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const ORIGINAL = { provider: process.env.EMAIL_PROVIDER, key: process.env.RESEND_API_KEY }

describe('getEmailProvider', () => {
  beforeEach(() => {
    vi.resetModules() // the module caches a singleton
  })
  afterEach(() => {
    process.env.EMAIL_PROVIDER = ORIGINAL.provider
    process.env.RESEND_API_KEY = ORIGINAL.key
  })

  it('resolves the mock provider by default', async () => {
    delete process.env.EMAIL_PROVIDER
    const { getEmailProvider } = await import('@/lib/email')
    expect(getEmailProvider().constructor.name).toBe('MockEmailProvider')
  })

  it('resolves the REAL Resend provider when EMAIL_PROVIDER=resend', async () => {
    process.env.EMAIL_PROVIDER = 'resend'
    process.env.RESEND_API_KEY = 're_test_key_never_used_for_sending'
    const { getEmailProvider } = await import('@/lib/email')
    expect(getEmailProvider().constructor.name).toBe('ResendEmailProvider')
  })

  it('fails loudly on an unknown provider name', async () => {
    process.env.EMAIL_PROVIDER = 'sendgrid'
    const { getEmailProvider } = await import('@/lib/email')
    expect(() => getEmailProvider()).toThrow(/Unknown email provider/)
  })

  it('refuses to construct the Resend provider without an API key', async () => {
    process.env.EMAIL_PROVIDER = 'resend'
    delete process.env.RESEND_API_KEY
    const { getEmailProvider } = await import('@/lib/email')
    expect(() => getEmailProvider()).toThrow(/RESEND_API_KEY is required/)
  })
})
