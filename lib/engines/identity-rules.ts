/**
 * Identity tier derivation (B3.2) — PURE; the tier is DERIVED from profile
 * facts + verified channels, never stored. Consumed by the snapshot loader
 * (which puts the derived tier on DomainSnapshot.identity) and by
 * deriveAndExpose / the A2 gateway through the identity-requirements rows
 * (requires_identity blocking with a needs payload).
 */

import { validateCnpChecksum, cnpMatchesDob } from '@/lib/engines/cnp-validation'
import { IDENTITY_REQUIREMENTS, evaluateRow } from '@/lib/engines/identity-requirements'
import type { IdentityTier } from '@/lib/engines/domain-types'

export { IDENTITY_REQUIREMENTS }

export interface IdentityFacts {
  fields: Partial<Record<'name' | 'cnp' | 'dateOfBirth' | 'email' | 'phone', { value: string; provenance: 'declared' | 'verified' | 'conflict' }>>
  verifiedChannels: ('email' | 'sms')[]
}

const KYC: (keyof IdentityFacts['fields'])[] = ['name', 'cnp', 'dateOfBirth', 'email', 'phone']

export function deriveIdentityTier(f: IdentityFacts): IdentityTier {
  const all = KYC.every((k) => f.fields[k] && f.fields[k]!.provenance !== 'conflict')
  const cnp = f.fields.cnp?.value
  const dob = f.fields.dateOfBirth?.value
  const cnpOk = !!cnp && validateCnpChecksum(cnp) && (!dob || cnpMatchesDob(cnp, new Date(dob)) !== false)
  if (!all || !cnpOk) return 'anonymous'
  return f.verifiedChannels.length > 0 ? 'verified_channel' : 'declared'
}

/** The KYC fields still missing (or in conflict) — surfaced to the GUI/profile payloads. */
export function missingIdentityFields(f: IdentityFacts): string[] {
  return KYC.filter((k) => !f.fields[k] || f.fields[k]!.provenance === 'conflict')
}

/**
 * Pure facts-side evaluation of a #1 row (erratum-1 signature): requiredDocs
 * come from Product.verificationRequirements, validatedDocs from the
 * customer's validated CustomerDocuments — both resolved by the caller.
 */
export function evaluateIdentityRequirement(
  tool: string,
  facts: IdentityFacts,
  requiredDocs: string[] = [],
  validatedDocs: string[] = [],
): { ok: true } | { ok: false; needs: string[] } {
  const req = IDENTITY_REQUIREMENTS[tool]
  if (!req) return { ok: true }
  const needs = evaluateRow(
    req,
    deriveIdentityTier(facts),
    (f) => facts.fields[f] !== undefined && facts.fields[f]!.provenance !== 'conflict',
    requiredDocs,
    validatedDocs,
    { missingFields: missingIdentityFields(facts), hasVerifiedChannel: facts.verifiedChannels.length > 0 },
  )
  return needs.length === 0 ? { ok: true } : { ok: false, needs }
}
