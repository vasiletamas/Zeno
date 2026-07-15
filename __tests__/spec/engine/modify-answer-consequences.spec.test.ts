import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spec } from '@/lib/spec/registry'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { computeConsequences, type Mutation, type PlannerSnapshot, type ConsequencePlan } from '@/lib/engines/consequence-planner'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'

const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const outline = parsed.scenarios.find((s) => s.tags.includes('@id:questionnaire/modify-answer-consequence'))!
const rows = outline.examples.filter((e) => !e.tags.includes('@backlog')).flatMap((e) => e.rows)

// Deviation from the plan literal: the shipped pure planner is
// computeConsequences over PlannerSnapshot + Mutation (not a hypothetical
// planModifyAnswer over the DomainSnapshot), and its plan has no `outcome`
// field — 'applied' is the empty plan, 'requires_confirmation' is the flag.
function snapshot(over: Partial<PlannerSnapshot> = {}): PlannerSnapshot {
  return {
    application: { exists: true, status: 'OPEN', quoteIssued: false },
    selection: { tier: 'standard', level: 'level_1', addon: true },
    answers: {
      active: { BD_CANCER_HISTORY: 'false', HEALTH_DECLARATION_CONFIRM: 'true', OCCUPATION: 'engineer' },
      sensitivity: { HEALTH_DECLARATION_CONFIRM: 'CONFIRM_ON_MODIFY', BD_CANCER_HISTORY: 'CONFIRM_ALWAYS' },
    },
    questionCodes: ['OCCUPATION', 'HEALTH_DECLARATION_CONFIRM', 'BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT'],
    product: { eligibilityRules: null },
    ...over,
  }
}

// question kind in the Examples table -> a concrete protect-graph mutation
const MUTATION_FOR: Record<string, { mutation: Mutation; snapshot: PlannerSnapshot }> = {
  'a neutral field': { mutation: { node: 'answer:OCCUPATION', newValue: 'teacher' }, snapshot: snapshot() },
  'a branching field': {
    mutation: { node: 'selection:addon', newValue: 'true' },
    snapshot: snapshot({ selection: { tier: 'standard', level: 'level_1', addon: false }, answers: { active: {}, sensitivity: {} } }),
  },
  'a gating field': { mutation: { node: 'selection:addon', newValue: 'false' }, snapshot: snapshot() },
  'a dependency': { mutation: { node: 'selection:tier', newValue: 'optim' }, snapshot: snapshot() },
  'a sensitive one': { mutation: { node: 'answer:HEALTH_DECLARATION_CONFIRM', newValue: 'false' }, snapshot: snapshot() },
}

function consequenceTokens(plan: ConsequencePlan): string[] {
  const tokens: string[] = [...plan.effects]
  if (plan.requiresConfirmation) tokens.push('requires_confirmation')
  if (tokens.length === 0) tokens.push('applied')
  return tokens
}

describe(spec('questionnaire/modify-answer-consequence'), () => {
  it.each(rows)('row %#: %s -> %s', (questionKind, consequence) => {
    const entry = MUTATION_FOR[questionKind]
    expect(entry, `no mutation mapping for Examples kind "${questionKind}" — extend MUTATION_FOR`).toBeDefined()
    const plan = computeConsequences(PROTECT_DEPENDENCY_EDGES, entry.snapshot, entry.mutation)
    expect(consequenceTokens(plan)).toContain(consequence)
  })
})
