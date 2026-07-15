import { describe, it, expect } from 'vitest'
import { selectReEngagementCandidates } from '@/lib/engagement/select-candidates'

const NOW = new Date('2026-06-12T08:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const CONFIG = { abandonedPaymentDays: 3, quoteExpiryWindowDays: 5, frequencyCapDays: 7 }

const base = {
  customerId: 'c1', conversationId: 'conv1',
  identityTier: 'verified_channel' as const,
  marketingConsent: true, gdprProcessingActive: true,
  lastOutboundAt: null as Date | null,
  abandonedPaymentSince: null as Date | null,
  quoteExpiresAt: null as Date | null,
}

describe('selectReEngagementCandidates (E4.4, M2)', () => {
  it('selects abandoned payment older than N days', () => {
    const rows = [{ ...base, abandonedPaymentSince: new Date(NOW.getTime() - 4 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([{ customerId: 'c1', conversationId: 'conv1', trigger: 'abandoned_payment' }])
  })
  it('selects quote expiring within the window', () => {
    const rows = [{ ...base, quoteExpiresAt: new Date(NOW.getTime() + 2 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)[0]).toMatchObject({ trigger: 'quote_expiring' })
  })
  it('skips non-verified-channel customers (hard rule)', () => {
    const rows = [{ ...base, identityTier: 'declared' as const, abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('skips when marketing consent is missing or withdrawn (B1 ledger says no)', () => {
    const rows = [{ ...base, marketingConsent: false, abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('skips when gdpr_processing is withdrawn (M3 scope-aware withdrawal)', () => {
    const rows = [{ ...base, gdprProcessingActive: false, abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('enforces the frequency cap from the last outbound', () => {
    const rows = [{ ...base, lastOutboundAt: new Date(NOW.getTime() - 2 * DAY), abandonedPaymentSince: new Date(NOW.getTime() - 9 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
  it('emits at most one outbound per customer per run (abandoned payment wins over quote expiry)', () => {
    const rows = [{ ...base, abandonedPaymentSince: new Date(NOW.getTime() - 4 * DAY), quoteExpiresAt: new Date(NOW.getTime() + 1 * DAY) }]
    const out = selectReEngagementCandidates(rows, CONFIG, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe('abandoned_payment')
  })
  it('an expired quote never triggers (the window is forward-looking)', () => {
    const rows = [{ ...base, quoteExpiresAt: new Date(NOW.getTime() - 1 * DAY) }]
    expect(selectReEngagementCandidates(rows, CONFIG, NOW)).toEqual([])
  })
})
