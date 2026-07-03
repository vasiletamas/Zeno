import { describe, it, expect } from 'vitest'
import { parseEligibilityRuleSet } from '@/lib/engines/eligibility'

describe('parseEligibilityRuleSet', () => {
  it('accepts a well-formed versioned ruleset', () => {
    const parsed = parseEligibilityRuleSet({
      version: 1,
      rules: [
        { id: 'min_age', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
        { id: 'bd_cancer', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
      ],
    })
    expect(parsed.version).toBe(1)
    expect(parsed.rules).toHaveLength(2)
  })
  it('rejects unknown operators and missing reasons (typo-silent Json dies here)', () => {
    expect(() => parseEligibilityRuleSet({ version: 1, rules: [{ id: 'x', subject: 'product', fact: 'age', op: 'gt!', value: 1, reason: 'r' }] })).toThrow()
    expect(() => parseEligibilityRuleSet({ version: 1, rules: [{ id: 'x', subject: 'product', fact: 'age', op: 'gte', value: 1 }] })).toThrow()
  })
  it('rejects legacy informal shapes (minAge/maxAge keys) so old seeds cannot silently pass', () => {
    expect(() => parseEligibilityRuleSet({ minAge: 18, maxAge: 64 })).toThrow()
  })
})
