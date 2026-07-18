/**
 * Pure generate_quote decision core (D1.3) — no DB. Composes the C2
 * eligibility and C3 suitability verdicts with consent/DNT/identity facts
 * into ONE typed decision. Check order: identity → compliance →
 * eligibility → suitability → referral. Suitability semantics mirror C3's
 * gate exactly (one predicate, two hosts): any non-suitable verdict
 * demands the documented-warning ack under warn_and_allow; hard_block
 * rejects with the mismatch's own reason regardless of acks.
 */
export interface QuoteDecisionInput {
  eligibility: { verdict: 'eligible' | 'ineligible' | 'unknown'; failedRules: { rule: string; reason: string }[]; missingFacts: string[] }
  suitability: { verdict: 'suitable' | 'conditionally_suitable' | 'unsuitable'; mismatches: { rule: string; reason: string }[] }
  suitabilityWarningAcked: boolean
  suitabilityPolicy: 'hard_block' | 'warn_and_allow'
  consents: { gdprProcessing: boolean }
  dnt: { validForProductType: boolean }
  identity: { hasDobOrCnp: boolean }
  escalationFlags: string[]
}
export type QuoteIssueDecision =
  | { outcome: 'issued' }
  | { outcome: 'rejected'; reason: string }
  | { outcome: 'referred'; reason: string }
  | { outcome: 'requires_identity'; needs: string[] }

export function decideQuoteIssue(i: QuoteDecisionInput): QuoteIssueDecision {
  // T28: the wording mirrors the #1 row's anyDeclaredOf join — declaredAge
  // (the age asked directly) satisfies the gate like a DOB or CNP would.
  if (!i.identity.hasDobOrCnp) return { outcome: 'requires_identity', needs: ['declared:cnp_or_dateOfBirth_or_declaredAge'] }
  if (!i.consents.gdprProcessing || !i.dnt.validForProductType) return { outcome: 'rejected', reason: 'compliance_block' }
  if (i.eligibility.verdict === 'ineligible') return { outcome: 'rejected', reason: i.eligibility.failedRules[0]?.reason ?? 'ineligible' }
  if (i.eligibility.verdict === 'unknown') return { outcome: 'requires_identity', needs: i.eligibility.missingFacts.map(f => `declared:${f}`) }
  if (i.suitability.verdict !== 'suitable') {
    if (i.suitabilityPolicy === 'hard_block' && i.suitability.verdict === 'unsuitable') {
      return { outcome: 'rejected', reason: i.suitability.mismatches[0]?.reason ?? 'suitability_warning_unacknowledged' }
    }
    if (!i.suitabilityWarningAcked) return { outcome: 'rejected', reason: 'suitability_warning_unacknowledged' }
  }
  if (i.escalationFlags.length > 0) return { outcome: 'referred', reason: 'manual_underwriting' }
  return { outcome: 'issued' }
}
