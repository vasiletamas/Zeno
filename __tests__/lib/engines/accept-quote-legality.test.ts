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
  it('quote_expired via the shared isExpired predicate', () => {
    expect(acceptQuoteLegality({ ...ok, quote: { ...ok.quote, validUntil: new Date(0) } }, new Date()))
      .toEqual({ ok: false, outcome: 'rejected', reason: 'quote_expired' })
  })
})
