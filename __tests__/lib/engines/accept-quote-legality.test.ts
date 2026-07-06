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
  // Precise needs (2026-07-06 battery wall): "needs: verified_channel" told
  // the agent to re-verify a channel the customer had JUST verified — the
  // actual gap was the undeclared phone. A rich identity slice names the
  // missing pieces via the shared evaluateRow semantics; the tier-only slice
  // above keeps the coarse tier word for legacy callers.
  it('requires_identity names the ACTUAL missing KYC pieces when the slice carries fields + channels', () => {
    const identity = {
      tier: 'declared' as const,
      fields: {
        name: { provenance: 'declared' as const }, cnp: { provenance: 'declared' as const },
        dateOfBirth: { provenance: 'declared' as const }, email: { provenance: 'verified' as const },
      },
      verifiedChannels: ['email' as const],
    }
    expect(acceptQuoteLegality({ ...ok, identity }, new Date()))
      .toEqual({ ok: false, outcome: 'requires_identity', needs: ['declared:phone'] })
  })
  it('rich slice with all fields but NO verified channel names verified_channel (and only that)', () => {
    const fields = {
      name: { provenance: 'declared' as const }, cnp: { provenance: 'declared' as const },
      dateOfBirth: { provenance: 'declared' as const }, email: { provenance: 'declared' as const },
      phone: { provenance: 'declared' as const },
    }
    expect(acceptQuoteLegality({ ...ok, identity: { tier: 'declared', fields, verifiedChannels: [] } }, new Date()))
      .toEqual({ ok: false, outcome: 'requires_identity', needs: ['verified_channel'] })
  })
  it('quote_expired via the shared isExpired predicate', () => {
    expect(acceptQuoteLegality({ ...ok, quote: { ...ok.quote, validUntil: new Date(0) } }, new Date()))
      .toEqual({ ok: false, outcome: 'rejected', reason: 'quote_expired' })
  })
})
