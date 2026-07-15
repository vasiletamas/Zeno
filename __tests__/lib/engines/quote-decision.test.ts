import { describe, it, expect } from 'vitest'
import { decideQuoteIssue } from '@/lib/engines/quote-decision'

const base = {
  eligibility: { verdict: 'eligible' as const, failedRules: [], missingFacts: [] as string[] },
  suitability: { verdict: 'suitable' as const, mismatches: [] },
  suitabilityWarningAcked: false,
  suitabilityPolicy: 'warn_and_allow' as const, // product config (M7)
  consents: { gdprProcessing: true },
  dnt: { validForProductType: true },
  identity: { hasDobOrCnp: true },
  escalationFlags: [] as string[],
}

describe('decideQuoteIssue', () => {
  it('issues when everything passes', () => {
    expect(decideQuoteIssue(base)).toEqual({ outcome: 'issued' })
  })
  it('missing DOB/CNP -> requires_identity with needs payload (never the silent age-30 fallback)', () => {
    expect(decideQuoteIssue({ ...base, identity: { hasDobOrCnp: false } }))
      .toEqual({ outcome: 'requires_identity', needs: ['declared:cnp_or_dob'] })
  })
  it('failed eligibility rule -> rejected with the C2 reason (incl. addon age-band no-match)', () => {
    const r = decideQuoteIssue({ ...base, eligibility: { verdict: 'ineligible', failedRules: [{ rule: 'age_max', reason: 'ineligible_age_maximum' }], missingFacts: [] } })
    expect(r).toEqual({ outcome: 'rejected', reason: 'ineligible_age_maximum' })
  })
  it('gdpr_processing withdrawn or invalid DNT -> rejected(compliance_block); marketing consent is NEVER required', () => {
    expect(decideQuoteIssue({ ...base, consents: { gdprProcessing: false } })).toEqual({ outcome: 'rejected', reason: 'compliance_block' })
    expect(decideQuoteIssue({ ...base, dnt: { validForProductType: false } })).toEqual({ outcome: 'rejected', reason: 'compliance_block' })
  })
  // Deviation from the pinned literals recorded: the C3 vocabulary
  // (suitability_warning_unacknowledged; hard_block rejects with the
  // mismatch's OWN reason) was registered+translated first — one code per
  // concept (M6), and exposure/commit must never disagree.
  it('unacknowledged suitability mismatch blocks; acked mismatch passes under warn_and_allow (M7)', () => {
    const mismatch = { verdict: 'unsuitable' as const, mismatches: [{ rule: 'needs_fit', reason: 'product_has_no_investment_component' }] }
    expect(decideQuoteIssue({ ...base, suitability: mismatch }))
      .toEqual({ outcome: 'rejected', reason: 'suitability_warning_unacknowledged' })
    expect(decideQuoteIssue({ ...base, suitability: mismatch, suitabilityWarningAcked: true }))
      .toEqual({ outcome: 'issued' })
  })
  it('hard_block policy rejects with the mismatch reason regardless of acks (C3 gate parity)', () => {
    const mismatch = { verdict: 'unsuitable' as const, mismatches: [{ rule: 'needs_fit', reason: 'product_has_no_investment_component' }] }
    expect(decideQuoteIssue({ ...base, suitability: mismatch, suitabilityPolicy: 'hard_block', suitabilityWarningAcked: true }))
      .toEqual({ outcome: 'rejected', reason: 'product_has_no_investment_component' })
  })
  it('unknown eligibility -> requires_identity with the missing facts as needs', () => {
    expect(decideQuoteIssue({ ...base, eligibility: { verdict: 'unknown', failedRules: [], missingFacts: ['age'] } }))
      .toEqual({ outcome: 'requires_identity', needs: ['declared:age'] })
  })
  it('escalation flags -> referred(manual_underwriting)', () => {
    expect(decideQuoteIssue({ ...base, escalationFlags: ['bd_escalate'] }))
      .toEqual({ outcome: 'referred', reason: 'manual_underwriting' })
  })
})
