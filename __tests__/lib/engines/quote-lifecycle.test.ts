import { describe, it, expect } from 'vitest'
import { isExpired, effectiveQuoteStatus, canQuoteTransition } from '@/lib/engines/quote-lifecycle'

const t0 = new Date('2026-06-12T12:00:00Z')
const live = { status: 'ISSUED' as const, validUntil: new Date('2026-06-13T12:00:00Z') }
const stale = { status: 'ISSUED' as const, validUntil: new Date('2026-06-12T11:59:59Z') }

describe('quote lifecycle predicates', () => {
  it('isExpired is validUntil < now, only for non-terminal statuses', () => {
    expect(isExpired(live, t0)).toBe(false)
    expect(isExpired(stale, t0)).toBe(true)
    expect(isExpired({ status: 'ACCEPTED', validUntil: stale.validUntil }, t0)).toBe(false)
    expect(isExpired({ status: 'CANCELLED', validUntil: stale.validUntil }, t0)).toBe(false)
  })
  it('effectiveQuoteStatus reports EXPIRED for a time-expired ISSUED row even before the write', () => {
    expect(effectiveQuoteStatus(live, t0)).toBe('ISSUED')
    expect(effectiveQuoteStatus(stale, t0)).toBe('EXPIRED')
    expect(effectiveQuoteStatus({ status: 'ACCEPTED', validUntil: stale.validUntil }, t0)).toBe('ACCEPTED')
  })
  it('transition table: each status has exactly one entering commit', () => {
    expect(canQuoteTransition('ISSUED', 'ACCEPTED')).toBe(true)
    expect(canQuoteTransition('ISSUED', 'CANCELLED')).toBe(true)
    expect(canQuoteTransition('ISSUED', 'EXPIRED')).toBe(true)
    expect(canQuoteTransition('ACCEPTED', 'CANCELLED')).toBe(false)
    expect(canQuoteTransition('EXPIRED', 'ACCEPTED')).toBe(false)
    expect(canQuoteTransition('CANCELLED', 'ISSUED')).toBe(false)
  })
})
