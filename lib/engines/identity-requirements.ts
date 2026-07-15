/**
 * Identity-requirements table (A3.6 mechanism, contradiction #1; B3.2 rows).
 *
 * The engine consults one row per commit; an unmet requirement blocks the
 * action with requires_identity + a machine-readable needs payload.
 *
 * Deliberate interpretations (B3 erratum 4, recorded so nobody "corrects"
 * them): (a) generate_quote is encoded minTier 'anonymous' +
 * anyDeclaredOf [cnp, dateOfBirth] rather than the literal 'declared' tier
 * — the full declared tier already implies both fields, which would make
 * the ratified 'CNP-or-DOB' clause vacuous; this encoding keeps it
 * meaningful (either field alone unlocks quoting). (b) T4-R6's document
 * default is resolved to before-payment-session; flip by seeding
 * accept_quote's verificationRequirements if compliance wants accept-time.
 * Rows are keyed by REGISTERED commit tools; the payment-documents row
 * rides ensure_payment_session (D3.3 renamed the legacy initiate tool).
 */

import type { IdentityTier, DomainSnapshot } from './domain-types'

export interface IdentityRequirement {
  minTier: IdentityTier
  anyDeclaredOf?: ('cnp' | 'dateOfBirth')[]
  productDocuments?: boolean
}
export type IdentityRequirementsTable = Record<string, IdentityRequirement>

export const IDENTITY_REQUIREMENTS: IdentityRequirementsTable = {
  set_application: { minTier: 'anonymous' }, // no hard gate pre-needs-analysis (#1)
  sign_dnt: { minTier: 'anonymous' },
  generate_quote: { minTier: 'anonymous', anyDeclaredOf: ['cnp', 'dateOfBirth'] },
  accept_quote: { minTier: 'verified_channel' },
  ensure_payment_session: { minTier: 'verified_channel', productDocuments: true },
  // E3 (M3): disclosure demands a proven channel; erasure must stay open to
  // an anonymous chat user (erratum 6 ruling — the right cannot hide behind
  // the very identity data it erases).
  request_data_export: { minTier: 'verified_channel' },
  request_erasure: { minTier: 'anonymous' },
}

const TIER_ORDER: Record<IdentityTier, number> = { anonymous: 0, declared: 1, verified_channel: 2 }

/** The KYC field set the tier ladder is built on (B3.2) — exported here (not
 * identity-rules) because identity-rules imports this module. */
export const KYC_FIELDS = ['name', 'cnp', 'dateOfBirth', 'email', 'phone'] as const
export type KycField = (typeof KYC_FIELDS)[number]

/** The actionable decomposition of an unmet verified_channel requirement. */
export interface IdentityDetail { missingFields: string[]; hasVerifiedChannel: boolean }

/**
 * Core row evaluation shared by the pure facts path (identity-rules) and
 * the snapshot path below — one semantics, two presentations, so the OTP,
 * link, and engine legs cannot drift apart.
 *
 * With `detail`, an unmet verified_channel tier DECOMPOSES into the gaps the
 * agent can act on (run cmr9dw3s5 2026-07-06: the channel WAS verified and
 * dateOfBirth+phone were the real blockers, but the payload said only
 * 'verified_channel' — the agent polled state 15 turns, then escalated).
 * When fields and channel are complete but the tier still refuses, the one
 * remaining reason is an invalid CNP (checksum / DOB mismatch): valid:cnp.
 */
export function evaluateRow(
  req: IdentityRequirement,
  tier: IdentityTier,
  hasDeclared: (field: KycField) => boolean,
  requiredDocs: string[] = [],
  validatedDocs: string[] = [],
  detail?: IdentityDetail,
): string[] {
  const needs: string[] = []
  if (TIER_ORDER[tier] < TIER_ORDER[req.minTier]) {
    if (req.minTier === 'verified_channel' && detail) {
      for (const f of detail.missingFields) needs.push(`declared:${f}`)
      if (!detail.hasVerifiedChannel) needs.push('verified_channel')
      // fields + channel complete yet the tier refuses: the one remaining
      // reason is an invalid CNP (checksum / DOB mismatch) — name it, never
      // a tier word the agent may already have satisfied.
      if (needs.length === 0) needs.push('valid:cnp')
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
