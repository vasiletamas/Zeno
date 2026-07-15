import { describe, it, expect } from 'vitest'
import { gateSuitability, type SuitabilityRuleSet } from '@/lib/engines/suitability'

const warn: SuitabilityRuleSet = { version: 1, mode: 'warn_and_allow', rules: [
  { id: 'inv', fact: 'DNT_LIFE_SUBTYPE', op: 'equals', value: 'financial_and_investment', whenMatched: 'mismatch', reason: 'product_has_no_investment_component' },
] }
const hard: SuitabilityRuleSet = { ...warn, mode: 'hard_block' }
const unsuitableFacts = { DNT_LIFE_SUBTYPE: 'financial_and_investment' }

describe('gateSuitability (generate_quote gate — D1 host)', () => {
  it('suitable → ok', () => {
    expect(gateSuitability(warn, { DNT_LIFE_SUBTYPE: 'simple_protection' }, [])).toEqual({ ok: true })
  })
  it('warn mode + unacknowledged mismatch → blocked requires_disclosures with stable reason', () => {
    expect(gateSuitability(warn, unsuitableFacts, [])).toEqual({
      ok: false, outcome: 'requires_disclosures', reason: 'suitability_warning_unacknowledged',
      params: { mismatches: ['product_has_no_investment_component'], ruleSetVersion: 1 },
    })
  })
  it('warn mode + matching ack → ok (documented warning satisfied)', () => {
    expect(gateSuitability(warn, unsuitableFacts, [{ ruleSetVersion: 1 }])).toEqual({ ok: true })
  })
  it('stale ack (different ruleset version) does NOT satisfy the gate', () => {
    expect(gateSuitability(warn, unsuitableFacts, [{ ruleSetVersion: 0 }]).ok).toBe(false)
  })
  it('hard_block mode → rejected regardless of acks', () => {
    expect(gateSuitability(hard, unsuitableFacts, [{ ruleSetVersion: 1 }])).toEqual({
      ok: false, outcome: 'rejected', reason: 'product_has_no_investment_component',
      params: { mismatches: ['product_has_no_investment_component'], ruleSetVersion: 1 },
    })
  })
})
