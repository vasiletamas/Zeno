import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { gateQuoteEligibility, parseEligibilityRuleSet } from '@/lib/engines/eligibility'
import { PROTECT_ELIGIBILITY } from '@/prisma/seeds/seed-product'
import { makeSnapshot } from './snapshot-fixtures'

describe('eligibility consumption points', () => {
  it('DerivedStateV3 carries the discovery verdict: unknown age → unknown, age 70 → ineligible', () => {
    const unknown = deriveAndExpose(makeSnapshot({ eligibilityFacts: {} }))
    expect(unknown.state.eligibility.verdict).toBe('unknown')
    expect(unknown.state.eligibility.missingFacts).toContain('age')
    const old = deriveAndExpose(makeSnapshot({ eligibilityFacts: { age: 70, residency: 'Romania' } }))
    expect(old.state.eligibility.verdict).toBe('ineligible')
  })

  // erratum 3 (T11.D4): the ineligible verdict lands in blocked_actions too
  it('ineligible verdict blocks set_application with the first failed-rule reason; unknown does NOT block', () => {
    const r = deriveAndExpose(makeSnapshot({ eligibilityFacts: { age: 70, residency: 'Romania' } }))
    expect(r.actions.available).not.toContain('set_application')
    expect(r.actions.blocked.find((b) => b.action === 'set_application')).toMatchObject({ reason: 'ineligible_age_maximum' })
    // unknown age is normal in discovery — never a wall
    const unknown = deriveAndExpose(makeSnapshot({ eligibilityFacts: {} }))
    expect(unknown.actions.available).toContain('set_application')
  })

  it('gateQuoteEligibility maps verdicts onto the pinned CommitResult vocabulary for D1', () => {
    const rules = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    expect(gateQuoteEligibility(rules, { age: 30, residency: 'Romania' }, false)).toEqual({ ok: true })
    const rej = gateQuoteEligibility(rules, { age: 70, residency: 'Romania' }, false)
    expect(rej).toEqual({ ok: false, outcome: 'rejected', reason: 'ineligible_age_maximum', params: expect.any(Object) })
    const unk = gateQuoteEligibility(rules, { residency: 'Romania' }, false)
    expect(unk).toEqual({ ok: false, outcome: 'requires_identity', reason: 'eligibility_facts_missing', params: { needs: ['age'] } })
  })

  // erratum 2: unanswered questionnaire facts are NOT identity needs — they
  // reject (defense-in-depth; legality keeps generate_quote unexposed while
  // the questionnaire is incomplete)
  it('addon facts are demanded only when includesAddon; missing answer-facts reject rather than demand identity', () => {
    const rules = parseEligibilityRuleSet(PROTECT_ELIGIBILITY)
    const r = gateQuoteEligibility(rules, { age: 30, residency: 'Romania' }, true)
    expect(r).toEqual(expect.objectContaining({ ok: false, outcome: 'rejected', reason: 'eligibility_facts_missing' }))
    expect((r as { params: { needs: string[] } }).params.needs.every((n) => n.startsWith('answer:'))).toBe(true)
  })
})
