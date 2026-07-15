/**
 * Pure consequence planner (C1.3, T6/contradiction #4): given the typed
 * dependency graph, a planner snapshot and ONE mutation, compute the full
 * deterministic consequence plan — invalidations with causality, visible-set
 * diff (cascade_expand / questions_removed), eligibility re-evaluation via
 * the canonical C2 module (deterministic selection patch, never silent),
 * status transitions (derived, never a ratchet pre-quote — T6.D2) and the
 * sensitivity-driven confirmation requirement (T6.D3). The plan IS the
 * requires_confirmation preview (T6.D6); the C1.5 applier executes it.
 */
import {
  computeVisibleSet, nodeValue,
  type DependencyEdge, type GraphFacts, type NodeKey, type DependencyKind, type SelectionFacet,
} from './dependency-graph'
import { evaluateEligibility, type EligibilityRuleSet, type KnownFacts } from './eligibility'
import type { CommitEffect } from './domain-types'
import type { AppStatus } from './application-rules'

export interface Mutation { node: NodeKey; newValue: string | null }

/**
 * T6.D3 deviation (ratified 2026-07-06, product owner): CONFIRM_ALWAYS no
 * longer confirms the FIRST write — per-answer cards made the medical
 * questionnaire seven confirmations long. It now means (a) member of the
 * batch medical declaration signed once via sign_medical_declarations
 * (the sign_dnt precedent) and (b) confirm-on-modify with cascade preview,
 * same as CONFIRM_ON_MODIFY.
 */
export type QuestionSensitivityStr = 'NONE' | 'CONFIRM_ON_MODIFY' | 'CONFIRM_ALWAYS'

/**
 * The planner's input slice — built by the applier from the domain
 * snapshot + question catalog (kept separate from A1's DomainSnapshot so
 * the planner stays pure and narrowly typed).
 */
export interface PlannerSnapshot {
  application: { exists: boolean; status: AppStatus; quoteIssued: boolean }
  selection: { tier: string | null; level: string | null; addon: boolean | null }
  answers: { active: Record<string, string>; sensitivity: Record<string, QuestionSensitivityStr> }
  questionCodes: string[]
  product: { eligibilityRules: EligibilityRuleSet | null }
  /** identity facts for eligibility rules (age, residency) — erratum 1 */
  identityFacts?: Record<string, string | number | boolean>
}

export interface ConsequencePlan {
  mutation: Mutation
  invalidations: { node: NodeKey; cause: NodeKey; kind: DependencyKind; reason: string }[]
  questionsAdded: string[]
  questionsRemoved: string[]
  eligibilityOutcomes: { subject: 'product' | 'addon'; verdict: 'eligible' | 'ineligible' | 'unknown'; reasons: string[] }[]
  selectionPatch: Partial<{ tier: string | null; level: string | null; addon: boolean }>
  statusTransition: { from: 'COMPLETED'; to: 'OPEN' } | null
  requiresConfirmation: boolean
  effects: CommitEffect[]
}

function factsOf(s: PlannerSnapshot): GraphFacts {
  return { answers: { ...s.answers.active }, selection: { ...s.selection } }
}

function applyMutation(facts: GraphFacts, m: Mutation): GraphFacts {
  const next: GraphFacts = { answers: { ...facts.answers }, selection: { ...facts.selection } }
  if (m.node.startsWith('answer:')) {
    const code = m.node.slice('answer:'.length)
    if (m.newValue === null) delete next.answers[code]
    else next.answers[code] = m.newValue
  } else {
    const facet = m.node.slice('selection:'.length) as SelectionFacet
    if (facet === 'addon') next.selection.addon = m.newValue === 'true'
    else next.selection[facet] = m.newValue
  }
  return next
}

export function computeConsequences(
  graph: DependencyEdge[],
  snapshot: PlannerSnapshot,
  mutation: Mutation,
): ConsequencePlan {
  const before = factsOf(snapshot)
  let after = applyMutation(before, mutation)
  const effects = new Set<CommitEffect>()
  const invalidations: ConsequencePlan['invalidations'] = []
  const selectionPatch: ConsequencePlan['selectionPatch'] = {}
  const eligibilityOutcomes: ConsequencePlan['eligibilityOutcomes'] = []

  // 1. requires_confirmation: sensitive answer node being MODIFIED — both
  // sensitivity classes. First-write affirmation for CONFIRM_ALWAYS moved to
  // the sign_medical_declarations batch card (T6.D3 deviation, 2026-07-06).
  let requiresConfirmation = false
  if (mutation.node.startsWith('answer:')) {
    const code = mutation.node.slice('answer:'.length)
    const sens = snapshot.answers.sensitivity[code] ?? 'NONE'
    const hadValue = before.answers[code] !== undefined
    requiresConfirmation = (sens === 'CONFIRM_ALWAYS' || sens === 'CONFIRM_ON_MODIFY') && hadValue
  }

  // 2. VALIDITY edges: subject whose dependsOn node just changed → invalidate subject
  for (const e of graph) {
    if (e.kind !== 'VALIDITY' || e.dependsOnKey !== mutation.node) continue
    if (nodeValue(e.subjectKey, before) === null) continue
    invalidations.push({ node: e.subjectKey, cause: mutation.node, kind: 'VALIDITY', reason: 'validity_dependency_changed' })
    if (e.subjectKey.startsWith('selection:')) {
      const facet = e.subjectKey.slice('selection:'.length) as SelectionFacet
      if (facet === 'level') selectionPatch.level = null
      if (facet === 'tier') selectionPatch.tier = null
      after = applyMutation(after, { node: e.subjectKey, newValue: null })
    }
    effects.add('cascade_invalidate')
  }

  // 3. ELIGIBILITY edges touched by this mutation → re-evaluate via the
  // canonical module (C2). Facts are PREFIXED answer keys merged with the
  // identity facts (erratum 1 — bare codes would report every rule missing).
  const eligEdges = graph.filter(e => e.kind === 'ELIGIBILITY' && e.dependsOnKey === mutation.node)
  if (eligEdges.length > 0 && snapshot.product.eligibilityRules) {
    const facts: KnownFacts = {
      ...(snapshot.identityFacts ?? {}),
      ...Object.fromEntries(Object.entries(after.answers).map(([c, v]) => [`answer:${c}`, v])),
    }
    const result = evaluateEligibility(snapshot.product.eligibilityRules, facts, 'addon')
    eligibilityOutcomes.push({ subject: 'addon', verdict: result.verdict, reasons: result.failedRules.map(f => f.reason) })
    effects.add('eligibility_recheck')
    if (result.verdict === 'ineligible' && after.selection.addon) {
      selectionPatch.addon = false // deterministic, reported, never silent (contradiction #4 rule 4)
      after = applyMutation(after, { node: 'selection:addon', newValue: 'false' })
    }
  }

  // 4. Visible-set diff → cascade_expand / questions_removed (+ invalidate answers of removed questions)
  const codes = snapshot.questionCodes
  const visBefore = computeVisibleSet(graph, codes, before)
  const visAfter = computeVisibleSet(graph, codes, after)
  const questionsAdded = [...visAfter].filter(c => !visBefore.has(c))
  const questionsRemoved = [...visBefore].filter(c => !visAfter.has(c))
  if (questionsAdded.length > 0) effects.add('cascade_expand')
  if (questionsRemoved.length > 0) effects.add('questions_removed')
  for (const code of questionsRemoved) {
    if (before.answers[code] !== undefined) {
      invalidations.push({ node: `answer:${code}`, cause: mutation.node, kind: 'VISIBILITY', reason: 'removed_by_branch' })
      effects.add('cascade_invalidate')
    }
  }

  // 5. Status: derived, never a ratchet pre-quote (T6.D2)
  let statusTransition: ConsequencePlan['statusTransition'] = null
  const invalidating = invalidations.length > 0
  if (invalidating && snapshot.application.status === 'COMPLETED' && !snapshot.application.quoteIssued) {
    statusTransition = { from: 'COMPLETED', to: 'OPEN' }
  }

  // 6. re_rating: any selection facet change, or a plan that patches selection
  if (mutation.node.startsWith('selection:') || Object.keys(selectionPatch).length > 0) {
    effects.add('re_rating')
  }

  return {
    mutation, invalidations, questionsAdded, questionsRemoved, eligibilityOutcomes,
    selectionPatch, statusTransition, requiresConfirmation, effects: [...effects],
  }
}
