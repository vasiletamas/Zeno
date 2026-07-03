import { describe, it, expect } from 'vitest'
import { PROTECT_ELIGIBILITY } from '@/prisma/seeds/seed-product'
import { parseEligibilityRuleSet, evaluateEligibility, deriveEligibilityBounds } from '@/lib/engines/eligibility'

describe('protect eligibility seed', () => {
  it('parses under the typed schema (no informal keys survive)', () => {
    expect(() => parseEligibilityRuleSet(PROTECT_ELIGIBILITY)).not.toThrow()
  })
  it('preserves the existing business content: ages 18..64, Romania residency', () => {
    const rs = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    expect(deriveEligibilityBounds(rs)).toEqual({ minAge: 18, maxAge: 64, otherRuleCodes: ['residency'] })
    expect(evaluateEligibility(rs, { age: 30, residency: 'Romania' }, 'product').verdict).toBe('eligible')
    expect(evaluateEligibility(rs, { age: 17, residency: 'Romania' }, 'product').verdict).toBe('ineligible')
    expect(evaluateEligibility(rs, { age: 30, residency: 'Germany' }, 'product').verdict).toBe('ineligible')
  })
  it('carries the addon medical rules: any bd yes → addon ineligible', () => {
    const rs = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    const facts = { age: 30, 'answer:BD_TRANSPLANT': 'true' }
    expect(evaluateEligibility(rs, facts, 'addon').verdict).toBe('ineligible')
  })
  it('keeps the authored narrative for presentation', () => {
    const rs = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    expect(rs.narrative).toBeDefined() // 50,000 EUR cumulative-sum note etc.
  })
})
