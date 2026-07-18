/**
 * Identity-requirements table (A3.6 mechanism, contradiction #1; B3.2 rows).
 *
 * The engine consults one row per commit; an unmet requirement blocks the
 * action with requires_identity + a machine-readable needs payload.
 *
 * Deliberate interpretations (B3 erratum 4, recorded so nobody "corrects"
 * them): (a) generate_quote is encoded minTier 'anonymous' +
 * anyDeclaredOf [cnp, dateOfBirth, declaredAge] rather than the literal
 * 'declared' tier — any one age-bearing fact alone unlocks quoting; T28
 * (P5.1) added declaredAge so the quote rates on the AGE asked directly
 * ("câți ani ai?") and the CNP is never demanded by mouth. (b) T4-R6's
 * document default is resolved to before-payment-session; flip by seeding
 * accept_quote's verificationRequirements if compliance wants accept-time.
 * Rows are keyed by REGISTERED commit tools; the payment-documents row
 * rides ensure_payment_session (D3.3 renamed the legacy initiate tool).
 */

import type { IdentityTier, DomainSnapshot } from './domain-types'

export interface IdentityRequirement {
  minTier: IdentityTier
  anyDeclaredOf?: ('cnp' | 'dateOfBirth' | 'declaredAge')[]
  productDocuments?: boolean
}
export type IdentityRequirementsTable = Record<string, IdentityRequirement>

export const IDENTITY_REQUIREMENTS: IdentityRequirementsTable = {
  set_application: { minTier: 'anonymous' }, // no hard gate pre-needs-analysis (#1)
  sign_dnt: { minTier: 'anonymous' },
  generate_quote: { minTier: 'anonymous', anyDeclaredOf: ['cnp', 'dateOfBirth', 'declaredAge'] },
  accept_quote: { minTier: 'verified_channel' },
  ensure_payment_session: { minTier: 'verified_channel', productDocuments: true },
  // E3 (M3): disclosure demands a proven channel; erasure must stay open to
  // an anonymous chat user (erratum 6 ruling — the right cannot hide behind
  // the very identity data it erases).
  request_data_export: { minTier: 'verified_channel' },
  request_erasure: { minTier: 'anonymous' },
}

const TIER_ORDER: Record<IdentityTier, number> = { anonymous: 0, declared: 1, verified_channel: 2 }

/** The KYC field set the tier ladder is built on — exported here (not
 * identity-rules) because identity-rules imports this module. T28 (P5.1)
 * shrank it to the CONTACT pair: pre-acceptance collection is phone+email
 * ONLY; name/DOB/CNP arrive later via ID extraction (T27) with document
 * provenance and must never wall the funnel. */
export const KYC_FIELDS = ['email', 'phone'] as const
export type KycField = (typeof KYC_FIELDS)[number]
/** Fields a row's anyDeclaredOf clause may name — a superset of KYC_FIELDS. */
export type DeclarableField = KycField | 'cnp' | 'dateOfBirth' | 'declaredAge'

/** The actionable decomposition of an unmet verified_channel requirement. */
export interface IdentityDetail { missingFields: string[]; hasVerifiedChannel: boolean }

/**
 * Core row evaluation shared by the pure facts path (identity-rules) and
 * the snapshot path below — one semantics, two presentations, so the OTP,
 * link, and engine legs cannot drift apart.
 *
 * With `detail`, an unmet verified_channel tier DECOMPOSES into the gaps the
 * agent can act on (run cmr9dw3s5 2026-07-06: the channel WAS verified and
 * real blockers were missing, but the payload said only 'verified_channel'
 * — the agent polled state 15 turns, then escalated). T28: the old
 * valid:cnp fallback died with the CNP tier gate — with the contact-only
 * ladder a complete decomposition IS the tier, so an empty-needs refusal can
 * only be inconsistent caller facts; the coarse label is the honest answer.
 */
export function evaluateRow(
  req: IdentityRequirement,
  tier: IdentityTier,
  hasDeclared: (field: DeclarableField) => boolean,
  requiredDocs: string[] = [],
  validatedDocs: string[] = [],
  detail?: IdentityDetail,
): string[] {
  const needs: string[] = []
  if (TIER_ORDER[tier] < TIER_ORDER[req.minTier]) {
    if (req.minTier === 'verified_channel' && detail) {
      for (const f of detail.missingFields) needs.push(`declared:${f}`)
      if (!detail.hasVerifiedChannel) needs.push('verified_channel')
      // decomposition sees no gap yet the tier refuses — inconsistent facts
      // guard (T28: valid:cnp is dead; CNP quality is document review's).
      if (needs.length === 0) needs.push('verified_channel')
    } else {
      needs.push(req.minTier === 'verified_channel' ? 'verified_channel' : 'declared')
    }
  }
  if (req.anyDeclaredOf && !req.anyDeclaredOf.some(hasDeclared)) {
    needs.push(`declared:${req.anyDeclaredOf.join('_or_')}`)
  }
  if (req.productDocuments) {
    for (const kind of requiredDocs) if (!validatedDocs.includes(kind)) needs.push(`document:${kind}`)
  }
  return [...new Set(needs)]
}

/** Snapshot-side check consumed by deriveAndExpose (tier already derived by the loader). */
export function checkIdentityRequirement(
  table: IdentityRequirementsTable,
  tool: string,
  identity: DomainSnapshot['identity'],
  requiredDocs: string[] = [],
  validatedDocs: string[] = [],
): { ok: true } | { ok: false; needs: string[] } {
  const req = table[tool]
  if (!req) return { ok: true }
  const needs = evaluateRow(
    req,
    identity.tier,
    (f) => identity.fields[f] !== undefined && identity.fields[f]!.provenance !== 'conflict',
    requiredDocs,
    validatedDocs,
    identityDetailFromSnapshot(identity),
  )
  return needs.length === 0 ? { ok: true } : { ok: false, needs }
}

/** The decomposition facts from the snapshot identity slice. */
export function identityDetailFromSnapshot(identity: DomainSnapshot['identity']): IdentityDetail {
  return {
    missingFields: KYC_FIELDS.filter((k) => identity.fields[k] === undefined || identity.fields[k]!.provenance === 'conflict'),
    hasVerifiedChannel: identity.verifiedChannels.length > 0,
  }
}
