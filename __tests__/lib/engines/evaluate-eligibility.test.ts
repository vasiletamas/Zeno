import { describe, it, expect } from 'vitest'
import { evaluateEligibility, type EligibilityRuleSet } from '@/lib/engines/eligibility'

const RULES: EligibilityRuleSet = {
  version: 1,
  rules: [
    { id: 'min_age', subject: 'product', fact: 'age', op: 'gte', value: 18, reason: 'ineligible_age_minimum' },
    { id: 'max_age', subject: 'product', fact: 'age', op: 'lte', value: 64, reason: 'ineligible_age_maximum' },
    { id: 'bd_cancer', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
    { id: 'addon_age', subject: 'addon', fact: 'age', op: 'between', value: [18, 64], reason: 'addon_age_band_unavailable' },
  ],
}

describe('evaluateEligibility', () => {
  it('age 70 → ineligible with failedRules carrying the stable reason', () => {
    const r = evaluateEligibility(RULES, { age: 70 }, 'product')
    expect(r.verdict).toBe('ineligible')
    expect(r.failedRules).toContainEqual(expect.objectContaining({ reason: 'ineligible_age_maximum' }))
  })
  it('age unknown → unknown verdict with missingFacts (NEVER a silent age-30 fallback)', () => {
    const r = evaluateEligibility(RULES, {}, 'product')
    expect(r.verdict).toBe('unknown')
    expect(r.missingFacts).toContain('age')
    expect(r.failedRules).toEqual([])
  })
  it('all product facts pass → eligible even while addon facts are missing (subject scoping)', () => {
    const r = evaluateEligibility(RULES, { age: 30 }, 'product')
    expect(r.verdict).toBe('eligible')
  })
  it('addon: bd yes → ineligible regardless of other rules; bd unanswered → unknown', () => {
    expect(evaluateEligibility(RULES, { age: 30, 'answer:BD_CANCER_HISTORY': 'true' }, 'addon').verdict).toBe('ineligible')
    expect(evaluateEligibility(RULES, { age: 30 }, 'addon').verdict).toBe('unknown')
  })
  it('a failed rule wins over missing facts (ineligible beats unknown — early decisive signal)', () => {
    const r = evaluateEligibility(RULES, { 'answer:BD_CANCER_HISTORY': 'true' }, 'addon')
    expect(r.verdict).toBe('ineligible')
  })
})
