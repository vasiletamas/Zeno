import { describe, it, expect } from 'vitest'
import {
  evaluatePredicate, nodeValue, computeVisibleSet,
  type DependencyEdge, type GraphFacts,
} from '@/lib/engines/dependency-graph'

const facts = (over: Partial<GraphFacts> = {}): GraphFacts => ({
  answers: {},
  selection: { tier: null, level: null, addon: null },
  ...over,
})

describe('nodeValue', () => {
  it('reads answer nodes from active answers and selection nodes from selection', () => {
    const f = facts({ answers: { BD_CANCER_HISTORY: 'true' }, selection: { tier: 'standard', level: null, addon: true } })
    expect(nodeValue('answer:BD_CANCER_HISTORY', f)).toBe('true')
    expect(nodeValue('selection:tier', f)).toBe('standard')
    expect(nodeValue('selection:addon', f)).toBe('true') // boolean normalized to string
    expect(nodeValue('selection:level', f)).toBeNull()
  })
})

describe('evaluatePredicate', () => {
  it('handles equals / in / is_true / is_false / any_answered', () => {
    expect(evaluatePredicate({ op: 'equals', value: 'optim' }, 'optim')).toBe(true)
    expect(evaluatePredicate({ op: 'in', value: ['somewhat', 'very_important'] }, 'somewhat')).toBe(true)
    expect(evaluatePredicate({ op: 'is_true' }, 'da')).toBe(true)  // boolean normalization
    expect(evaluatePredicate({ op: 'is_false' }, 'nu')).toBe(true)
    expect(evaluatePredicate({ op: 'any_answered' }, 'anything')).toBe(true)
    expect(evaluatePredicate({ op: 'any_answered' }, null)).toBe(false)
  })
})

describe('computeVisibleSet', () => {
  const graph: DependencyEdge[] = [
    { subjectKey: 'answer:BD_CANCER_HISTORY', dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } },
    { subjectKey: 'answer:DNT_SUSTAINABILITY_PREFERENCE', dependsOnKey: 'answer:DNT_SUSTAINABILITY_IMPORTANCE', kind: 'VISIBILITY', predicate: { op: 'in', value: ['somewhat', 'quite_important', 'very_important'] } },
  ]
  const codes = ['BD_CANCER_HISTORY', 'DNT_SUSTAINABILITY_IMPORTANCE', 'DNT_SUSTAINABILITY_PREFERENCE', 'HEALTH_DECLARATION_CONFIRM']
  it('hides questions whose VISIBILITY gate is unmet or gate node unanswered', () => {
    const visible = computeVisibleSet(graph, codes, facts())
    expect(visible.has('HEALTH_DECLARATION_CONFIRM')).toBe(true) // no edges → visible
    expect(visible.has('BD_CANCER_HISTORY')).toBe(false)         // addon null
    expect(visible.has('DNT_SUSTAINABILITY_PREFERENCE')).toBe(false)
  })
  it('shows gated questions when the gate matches', () => {
    const f = facts({ answers: { DNT_SUSTAINABILITY_IMPORTANCE: 'somewhat' }, selection: { tier: null, level: null, addon: true } })
    const visible = computeVisibleSet(graph, codes, f)
    expect(visible.has('BD_CANCER_HISTORY')).toBe(true)
    expect(visible.has('DNT_SUSTAINABILITY_PREFERENCE')).toBe(true)
  })
  it('requires ALL visibility edges of a multi-parent question to match (AND semantics)', () => {
    const multi: DependencyEdge[] = [
      ...graph,
      { subjectKey: 'answer:BD_CANCER_HISTORY', dependsOnKey: 'answer:HEALTH_DECLARATION_CONFIRM', kind: 'VISIBILITY', predicate: { op: 'is_true' } },
    ]
    const f = facts({ selection: { tier: null, level: null, addon: true } })
    expect(computeVisibleSet(multi, codes, f).has('BD_CANCER_HISTORY')).toBe(false)
    f.answers.HEALTH_DECLARATION_CONFIRM = 'true'
    expect(computeVisibleSet(multi, codes, f).has('BD_CANCER_HISTORY')).toBe(true)
  })
})
