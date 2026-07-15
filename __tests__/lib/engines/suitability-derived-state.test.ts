import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'
import { PROTECT_SUITABILITY } from '@/prisma/seeds/seed-product'
import { parseSuitabilityRuleSet } from '@/lib/engines/suitability'
import type { DomainSnapshot } from '@/lib/engines/domain-types'

const RULES = parseSuitabilityRuleSet(PROTECT_SUITABILITY)

function snapWithDnt(over: { signed: boolean; facts: Record<string, string> }): DomainSnapshot {
  const base = makeSnapshot()
  return {
    ...base,
    product: { ...base.product!, suitabilityRules: RULES },
    dnt: { ...base.dnt, signed: over.signed, valid: over.signed, facts: over.facts },
  }
}

describe('DerivedStateV3.suitability', () => {
  it('is null before sign_dnt (no fit claims possible)', () => {
    const { state } = deriveAndExpose(snapWithDnt({ signed: false, facts: {} }))
    expect(state.suitability).toBeNull()
  })
  it('carries the verdict + mismatches after sign_dnt', () => {
    const { state } = deriveAndExpose(snapWithDnt({ signed: true, facts: { DNT_LIFE_SUBTYPE: 'financial_and_investment' } }))
    expect(state.suitability?.verdict).toBe('unsuitable')
    expect(state.suitability?.mismatches[0].reason).toBe('product_has_no_investment_component')
  })
  it('suitable path: clean facts → suitable verdict (the engine-gated source for any agent fit claim — prompt invariant lands in A4)', () => {
    const { state } = deriveAndExpose(snapWithDnt({ signed: true, facts: { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' } }))
    expect(state.suitability?.verdict).toBe('suitable')
  })
})
