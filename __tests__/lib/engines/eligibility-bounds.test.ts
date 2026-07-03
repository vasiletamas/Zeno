import { describe, it, expect } from 'vitest'
import { deriveEligibilityBounds, type EligibilityRuleSet } from '@/lib/engines/eligibility'

describe('deriveEligibilityBounds', () => {
  it('derives numeric age bounds from gte/lte/between product rules', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'a', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
      { id: 'b', subject: 'product', fact: 'age', op: 'lte', value: 64, reason: 'ineligible_age_maximum' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 18, maxAge: 64 })
  })
  it('returns nulls when no age rules exist (presentation must not invent numbers)', () => {
    expect(deriveEligibilityBounds({ version: 1, rules: [] })).toEqual({ minAge: null, maxAge: null })
  })
  it('between rule contributes both bounds', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'c', subject: 'product', fact: 'age', op: 'between', value: [21, 60], reason: 'ineligible_age' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 21, maxAge: 60 })
  })
})
