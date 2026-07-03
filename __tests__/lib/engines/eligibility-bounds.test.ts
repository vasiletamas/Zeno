import { describe, it, expect } from 'vitest'
import { deriveEligibilityBounds, type EligibilityRuleSet } from '@/lib/engines/eligibility'

describe('deriveEligibilityBounds', () => {
  it('derives numeric age bounds from gte/lte/between product rules', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'a', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
      { id: 'b', subject: 'product', fact: 'age', op: 'lte', value: 64, reason: 'ineligible_age_maximum' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 18, maxAge: 64, otherRuleCodes: [] })
  })
  it('returns nulls when no age rules exist (presentation must not invent numbers)', () => {
    expect(deriveEligibilityBounds({ version: 1, rules: [] })).toEqual({ minAge: null, maxAge: null, otherRuleCodes: [] })
  })
  it('between rule contributes both bounds', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'c', subject: 'product', fact: 'age', op: 'between', value: [21, 60], reason: 'ineligible_age' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 21, maxAge: 60, otherRuleCodes: [] })
  })
  it('E1.5: non-age PRODUCT rules are listed by id; addon rules stay out of the product projection', () => {
    const rules: EligibilityRuleSet = { version: 1, rules: [
      { id: 'min_age', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
      { id: 'residency', subject: 'product', fact: 'residency', op: 'equals', value: 'Romania', reason: 'ineligible_residency' },
      { id: 'bd_cancer', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
    ] }
    expect(deriveEligibilityBounds(rules)).toEqual({ minAge: 18, maxAge: null, otherRuleCodes: ['residency'] })
  })
})
