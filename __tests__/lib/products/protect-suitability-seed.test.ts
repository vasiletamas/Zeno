import { describe, it, expect } from 'vitest'
import { PROTECT_SUITABILITY } from '@/prisma/seeds/seed-product'
import { parseSuitabilityRuleSet, evaluateSuitability } from '@/lib/engines/suitability'

describe('protect suitability seed (v1 — content flagged for compliance input)', () => {
  it('parses under the typed schema with warn_and_allow mode', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    expect(rs.mode).toBe('warn_and_allow')
    expect(rs.version).toBe(1)
  })
  it('investment demand → unsuitable (protect has no investment component)', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    expect(evaluateSuitability(rs, { DNT_LIFE_SUBTYPE: 'financial_and_investment' }).verdict).toBe('unsuitable')
  })
  it('severe-conditions demand → conditionally_suitable (BD addon is the conditional fit)', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    const r = evaluateSuitability(rs, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'yes' })
    expect(r.verdict).toBe('conditionally_suitable')
    expect(r.mismatches[0].reason).toBe('severe_conditions_demand_needs_addon')
  })
  it('simple protection demand → suitable', () => {
    const rs = parseSuitabilityRuleSet(PROTECT_SUITABILITY)
    expect(evaluateSuitability(rs, { DNT_LIFE_SUBTYPE: 'simple_protection', DNT_LIFE_SEVERE_CONDITIONS: 'no' }).verdict).toBe('suitable')
  })
})
