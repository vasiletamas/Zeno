import { describe, it, expect } from 'vitest'
import { spec } from '@/lib/spec/registry'
import { toToolName } from '@/lib/spec/operations-map'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot, COMPLETED_APP, VALID_DNT, ISSUED_QUOTE, VERIFIED_IDENTITY } from '../helpers/spec-snapshots'

describe('Feature: Quote review and acceptance', () => {
  // "Then accept_quote returns rejected with reason quote_expired"
  it(spec('quote/expired-quote-cannot-be-accepted') + ' accept_quote blocked: quote_expired', () => {
    const { state, actions } = deriveAndExpose(makeSnapshot({
      application: COMPLETED_APP, dnt: VALID_DNT, identity: VERIFIED_IDENTITY,
      quote: { ...ISSUED_QUOTE, validUntil: '2020-01-01T00:00:00.000Z', expired: true },
    }))
    // expired issued quote falls back to QUOTE_GENERATION (regenerate loop killed)
    expect(state.phase).toBe('APPLICATION')
    const accept = toToolName('accept_quote')
    expect(actions.available).not.toContain(accept)
    expect(actions.blocked.find((b) => b.action === accept)?.reason).toBe('quote_expired')
  })

  // "Then accept_quote is blocked with reason requires_disclosures ... then becomes available"
  it(spec('quote/disclosures-precede-acceptance') + ' requires_disclosures gate', () => {
    const accept = toToolName('accept_quote')
    const before = deriveAndExpose(makeSnapshot({
      application: COMPLETED_APP, dnt: VALID_DNT, identity: VERIFIED_IDENTITY,
      quote: { ...ISSUED_QUOTE, disclosuresRequired: [{ kind: 'ipid', version: 1, language: 'ro' }] },
    }))
    expect(before.state.phase).toBe('QUOTE')
    expect(before.actions.blocked.find((b) => b.action === accept)?.reason).toBe('requires_disclosures')
    // the ack path itself is exposed on the live issued quote
    expect(before.actions.available).toContain(toToolName('acknowledge_disclosures'))
    const after = deriveAndExpose(makeSnapshot({
      application: COMPLETED_APP, dnt: VALID_DNT, identity: VERIFIED_IDENTITY,
      quote: ISSUED_QUOTE,
    }))
    expect(after.actions.available).toContain(accept)
  })
})
