/**
 * Identity-requirements table MECHANISM (A3.6, contradiction #1).
 *
 * The engine consults one row per commit; an unmet requirement blocks the
 * action with requires_identity + a machine-readable needs payload. The
 * shipped table is EMPTY — Block B lands the rows (e.g. accept_quote →
 * verified_channel per T4-R6).
 */

import type { IdentityTier, DomainSnapshot } from './domain-types'

export interface IdentityRequirement { minTier: IdentityTier; requiredFields: string[] }
export type IdentityRequirementsTable = Record<string, IdentityRequirement>

export const IDENTITY_REQUIREMENTS: IdentityRequirementsTable = {} // one row per commit; Block B lands the rows

const TIER_ORDER: Record<IdentityTier, number> = { anonymous: 0, declared: 1, verified_channel: 2 }

export function checkIdentityRequirement(table: IdentityRequirementsTable, tool: string, identity: DomainSnapshot['identity']): { ok: true } | { ok: false; needs: string[] } {
  const req = table[tool]
  if (!req) return { ok: true }
  const needs: string[] = []
  if (TIER_ORDER[identity.tier] < TIER_ORDER[req.minTier]) needs.push(`tier:${req.minTier}`)
  for (const f of req.requiredFields) if (!identity.fields[f]) needs.push(`declared:${f}`)
  return needs.length === 0 ? { ok: true } : { ok: false, needs }
}
