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
 * default is resolved to before-initiate_payment; flip by seeding
 * accept_quote's verificationRequirements if compliance wants accept-time.
 * Rows are keyed by REGISTERED commit tools: start_application is B4's
 * set_application surface today; the payment-documents row rides
 * initiate_payment until D3 lands ensure_payment_session.
 */

import type { IdentityTier, DomainSnapshot } from './domain-types'

export interface IdentityRequirement {
  minTier: IdentityTier
  anyDeclaredOf?: ('cnp' | 'dateOfBirth')[]
  productDocuments?: boolean
}
export type IdentityRequirementsTable = Record<string, IdentityRequirement>

export const IDENTITY_REQUIREMENTS: IdentityRequirementsTable = {
  start_application: { minTier: 'anonymous' }, // no hard gate pre-needs-analysis (#1)
  sign_dnt: { minTier: 'anonymous' },
  generate_quote: { minTier: 'anonymous', anyDeclaredOf: ['cnp', 'dateOfBirth'] },
  accept_quote: { minTier: 'verified_channel' },
  initiate_payment: { minTier: 'verified_channel', productDocuments: true },
}

const TIER_ORDER: Record<IdentityTier, number> = { anonymous: 0, declared: 1, verified_channel: 2 }

/**
 * Core row evaluation shared by the pure facts path (identity-rules) and
 * the snapshot path below — one semantics, two presentations, so the OTP,
 * link, and engine legs cannot drift apart.
 */
export function evaluateRow(
  req: IdentityRequirement,
  tier: IdentityTier,
  hasDeclared: (field: 'cnp' | 'dateOfBirth') => boolean,
  requiredDocs: string[] = [],
  validatedDocs: string[] = [],
): string[] {
  const needs: string[] = []
  if (TIER_ORDER[tier] < TIER_ORDER[req.minTier]) {
    needs.push(req.minTier === 'verified_channel' ? 'verified_channel' : 'declared')
  }
  if (req.anyDeclaredOf && !req.anyDeclaredOf.some(hasDeclared)) {
    needs.push(`declared:${req.anyDeclaredOf.join('_or_')}`)
  }
  if (req.productDocuments) {
    for (const kind of requiredDocs) if (!validatedDocs.includes(kind)) needs.push(`document:${kind}`)
  }
  return needs
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
  )
  return needs.length === 0 ? { ok: true } : { ok: false, needs }
}
