import { describe, it, expect } from 'vitest'
import { computeConsequences, type Mutation, type PlannerSnapshot } from '@/lib/engines/consequence-planner'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import type { EligibilityRuleSet } from '@/lib/engines/eligibility'

// C2 EligibilityRuleSet shape — facts are PREFIXED answer keys (erratum 1);
// the full seeded set arrives via the snapshot in production.
const PROTECT_RULES: EligibilityRuleSet = { version: 1, rules: [
  { id: 'addon_no_medical_history', subject: 'addon', fact: 'answer:BD_CANCER_HISTORY', op: 'is_false', reason: 'addon_ineligible_medical_history' },
] }

function snapshot(over: Partial<PlannerSnapshot> = {}): PlannerSnapshot {
  return {
    application: { exists: true, status: 'OPEN', quoteIssued: false },
    selection: { tier: 'standard', level: 'level_1', addon: true },
    answers: { active: {}, sensitivity: { HEALTH_DECLARATION_CONFIRM: 'CONFIRM_ON_MODIFY', BD_CANCER_HISTORY: 'CONFIRM_ALWAYS' } },
    questionCodes: ['HEALTH_DECLARATION_CONFIRM','BD_CANCER_HISTORY','BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT'],
    product: { eligibilityRules: PROTECT_RULES },
    ...over,
  }
}

describe('computeConsequences', () => {
  it('tier change → cascade_invalidate of selection:level + re_rating', () => {
    const m: Mutation = { node: 'selection:tier', newValue: 'optim' }
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snapshot(), m)
    expect(plan.invalidations).toContainEqual(expect.objectContaining({ node: 'selection:level', cause: 'selection:tier', kind: 'VALIDITY' }))
    expect(plan.effects).toContain('cascade_invalidate')
    expect(plan.effects).toContain('re_rating')
  })
  it('addon=false → questions_removed for visible bd_* questions, their active answers invalidated with causality', () => {
    const s = snapshot({ answers: { active: { BD_CANCER_HISTORY: 'false' }, sensitivity: {} } })
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'selection:addon', newValue: 'false' })
    expect(plan.questionsRemoved).toEqual(expect.arrayContaining(['BD_CANCER_HISTORY']))
    expect(plan.invalidations).toContainEqual(expect.objectContaining({ node: 'answer:BD_CANCER_HISTORY', cause: 'selection:addon' }))
    expect(plan.effects).toContain('questions_removed')
  })
  it('addon=true → cascade_expand listing the 6 bd_* questions', () => {
    const s = snapshot({ selection: { tier: 'standard', level: 'level_1', addon: false } })
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'selection:addon', newValue: 'true' })
    expect(plan.questionsAdded).toHaveLength(6)
    expect(plan.effects).toContain('cascade_expand')
  })
  it('first bd yes → eligibility_recheck: addon ineligible, deterministic selection patch, remaining bd questions removed', () => {
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snapshot(), { node: 'answer:BD_CANCER_HISTORY', newValue: 'true' })
    expect(plan.eligibilityOutcomes).toContainEqual(expect.objectContaining({ subject: 'addon', verdict: 'ineligible' }))
    expect(plan.selectionPatch).toEqual(expect.objectContaining({ addon: false }))
    expect(plan.questionsRemoved).toEqual(expect.arrayContaining(['BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT']))
    expect(plan.effects).toEqual(expect.arrayContaining(['eligibility_recheck', 'questions_removed']))
  })
  it('modifying a CONFIRM_ON_MODIFY answer that already has a value → requiresConfirmation', () => {
    const s = snapshot({ answers: { active: { HEALTH_DECLARATION_CONFIRM: 'true' }, sensitivity: { HEALTH_DECLARATION_CONFIRM: 'CONFIRM_ON_MODIFY' } } })
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'answer:HEALTH_DECLARATION_CONFIRM', newValue: 'false' })
    expect(plan.requiresConfirmation).toBe(true)
  })
  it('a CONFIRM_ALWAYS answer requires confirmation even on FIRST write (erratum 7, T6.D3)', () => {
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, snapshot(), { node: 'answer:BD_CANCER_HISTORY', newValue: 'false' })
    expect(plan.requiresConfirmation).toBe(true)
  })
  it('invalidation on a COMPLETED application without an issued quote → statusTransition COMPLETED→OPEN', () => {
    const s = snapshot({ application: { exists: true, status: 'COMPLETED', quoteIssued: false } })
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, s, { node: 'selection:tier', newValue: 'optim' })
    expect(plan.statusTransition).toEqual({ from: 'COMPLETED', to: 'OPEN' })
  })
})
