import { describe, it, expect } from 'vitest'
import { evaluateSuitability, parseSuitabilityRuleSet, type SuitabilityRuleSet } from '@/lib/engines/suitability'

const RULES: SuitabilityRuleSet = {
  version: 1,
  mode: 'warn_and_allow',
  rules: [
    { id: 'investment_demand', fact: 'DNT_LIFE_SUBTYPE', op: 'equals', value: 'financial_and_investment', whenMatched: 'mismatch', reason: 'product_has_no_investment_component' },
    { id: 'severe_conditions_demand', fact: 'DNT_LIFE_SEVERE_CONDITIONS', op: 'equals', value: 'yes', whenMatched: 'conditional', reason: 'severe_conditions_demand_needs_addon' },
  ],
}

describe('evaluateSuitability', () => {
  it('no rule fires → suitable, zero mismatches', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' })
    expect(r).toEqual({ verdict: 'suitable', mismatches: [] })
  })
  it('a mismatch rule fires → unsuitable with the stable reason code', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'financial_and_investment' })
    expect(r.verdict).toBe('unsuitable')
    expect(r.mismatches).toContainEqual(expect.objectContaining({ reason: 'product_has_no_investment_component' }))
  })
  it('only conditional rules fire → conditionally_suitable', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'yes' })
    expect(r.verdict).toBe('conditionally_suitable')
    expect(r.mismatches).toHaveLength(1)
  })
  it('mismatch beats conditional when both fire', () => {
    const r = evaluateSuitability(RULES, { DNT_LIFE_SUBTYPE: 'financial_and_investment', DNT_LIFE_SEVERE_CONDITIONS: 'yes' })
    expect(r.verdict).toBe('unsuitable')
    expect(r.mismatches).toHaveLength(2)
  })
  it('missing facts never fire rules (sign_dnt guarantees the visible DNT set is complete)', () => {
    expect(evaluateSuitability(RULES, {}).verdict).toBe('suitable')
  })
})

describe('parseSuitabilityRuleSet', () => {
  it('rejects unknown modes and ops', () => {
    expect(() => parseSuitabilityRuleSet({ version: 1, mode: 'maybe', rules: [] })).toThrow()
  })
})
