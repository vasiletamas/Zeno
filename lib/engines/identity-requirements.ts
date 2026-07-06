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

/** The KYC field set the verified_channel tier demands (B3.2). */
export const KYC_FIELDS = ['name', 'cnp', 'dateOfBirth', 'email', 'phone'] as const
export type KycField = (typeof KYC_FIELDS)[number]

/**
 * Core row evaluation shared by the pure facts path (identity-rules) and
 * the snapshot path below — one semantics, two presentations, so the OTP,
 * link, and engine legs cannot drift apart.
 *
 * PRECISE needs (2026-07-06, the recorded "name missing" hallucination):
 * a verified_channel gap names the ACTUAL missing pieces — the undeclared
 * KYC fields and/or the unverified channel — never a bare tier word the
 * agent may already have satisfied half of. When fields and channel are
 * complete but the tier still refuses, the one remaining reason is an
 * invalid CNP (checksum / DOB mismatch): valid:cnp.
 */
export function evaluateRow(
  req: IdentityRequirement,
  tier: IdentityTier,
  hasDeclared: (field: KycField) => boolean,
  requiredDocs: string[] = [],
  validatedDocs: string[] = [],
  hasVerifiedChannel = false,
): string[] {
  const needs: string[] = []
  if (TIER_ORDER[tier] < TIER_ORDER[req.minTier]) {
    if (req.minTier === 'verified_channel') {
      needs.push(...KYC_FIELDS.filter((f) => !hasDeclared(f)).map((f) => `declared:${f}`))
      if (!hasVerifiedChannel) needs.push('verified_channel')
      if (needs.length === 0) needs.push('valid:cnp')
    } else {
      needs.push('declared')
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
    identity.verifiedChannels.length > 0,
  )
  return needs.length === 0 ? { ok: true } : { ok: false, needs }
}
