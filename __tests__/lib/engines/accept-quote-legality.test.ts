import { describe, it, expect } from 'vitest'
import { acceptQuoteLegality } from '@/lib/engines/accept-quote-legality'

const ok = {
  quote: { status: 'ISSUED' as const, validUntil: new Date(Date.now() + 86_400_000), disclosuresRequired: [] as { kind: string }[] },
  identity: { tier: 'verified_channel' as const },
}

describe('accept_quote legality (pure, D2.5)', () => {
  it('passes on ISSUED + acked disclosures + verified channel', () => {
    expect(acceptQuoteLegality(ok, new Date())).toEqual({ ok: true })
  })
  it('requires_disclosures when any disclosure outstanding', () => {
    expect(acceptQuoteLegality({ ...ok, quote: { ...ok.quote, disclosuresRequired: [{ kind: 'IPID' }] } }, new Date()))
      .toEqual({ ok: false, outcome: 'requires_disclosures', needs: ['IPID'] })
  })
  it('requires_identity below verified_channel (T4-R6 hard gate)', () => {
    expect(acceptQuoteLegality({ ...ok, identity: { tier: 'declared' } }, new Date()))
      .toEqual({ ok: false, outcome: 'requires_identity', needs: ['verified_channel'] })
  })
  it('needs DECOMPOSE to the actionable gaps when identity detail is provided (run cmr9dw3s5: channel verified, dob+phone missing, agent had nothing to act on)', () => {
    const r = acceptQuoteLegality(
      { ...ok, identity: { tier: 'anonymous', missingFields: ['dateOfBirth', 'phone'], hasVerifiedChannel: true } },
      new Date(),
    )
    expect(r).toEqual({ ok: false, outcome: 'requires_identity', needs: ['declared:dateOfBirth', 'declared:phone'] })
  })
  it('decomposed needs include verified_channel only when NO channel is verified', () => {
    const r = acceptQuoteLegality(
      { ...ok, identity: { tier: 'anonymous', missingFields: ['phone'], hasVerifiedChannel: false } },
      new Date(),
    )
    expect(r).toEqual({ ok: false, outcome: 'requires_identity', needs: ['declared:phone', 'verified_channel'] })
  })
  it('T28: falls back to the coarse verified_channel label when the decomposition is complete but the tier still refuses (valid:cnp died with the CNP tier gate)', () => {
    const r = acceptQuoteLegality(
      { ...ok, identity: { tier: 'anonymous', missingFields: [], hasVerifiedChannel: true } },
      new Date(),
    )
    expect(r).toEqual({ ok: false, outcome: 'requires_identity', needs: ['verified_channel'] })
  })
  it('quote_expired via the shared isExpired predicate', () => {
    expect(acceptQuoteLegality({ ...ok, quote: { ...ok.quote, validUntil: new Date(0) } }, new Date()))
      .toEqual({ ok: false, outcome: 'rejected', reason: 'quote_expired' })
  })
})
