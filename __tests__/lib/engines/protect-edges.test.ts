import { describe, it, expect } from 'vitest'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import { computeVisibleSet, type GraphFacts } from '@/lib/engines/dependency-graph'

const BD_CODES = ['BD_CANCER_HISTORY','BD_CARDIOVASCULAR','BD_NEUROLOGICAL','BD_TRANSPLANT','BD_CHRONIC_CONDITIONS','BD_HOSPITALIZATION_RECENT']

describe('protect dependency edges (contradiction #4 canonical set)', () => {
  it('declares selection:level VALIDITY-depends-on selection:tier', () => {
    expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
      expect.objectContaining({ subjectKey: 'selection:level', dependsOnKey: 'selection:tier', kind: 'VALIDITY' }),
    )
  })
  it('gates every bd_* question VISIBILITY on selection:addon is_true', () => {
    for (const code of BD_CODES) {
      expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
        expect.objectContaining({ subjectKey: `answer:${code}`, dependsOnKey: 'selection:addon', kind: 'VISIBILITY', predicate: { op: 'is_true' } }),
      )
    }
  })
  it('declares selection:addon ELIGIBILITY-depends-on every answer:bd_* with is_false', () => {
    for (const code of BD_CODES) {
      expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
        expect.objectContaining({ subjectKey: 'selection:addon', dependsOnKey: `answer:${code}`, kind: 'ELIGIBILITY', predicate: { op: 'is_false' } }),
      )
    }
  })
  it('carries the migrated DNT sustainability visibility edge', () => {
    expect(PROTECT_DEPENDENCY_EDGES).toContainEqual(
      expect.objectContaining({
        subjectKey: 'answer:DNT_SUSTAINABILITY_PREFERENCE',
        dependsOnKey: 'answer:DNT_SUSTAINABILITY_IMPORTANCE',
        kind: 'VISIBILITY',
        predicate: { op: 'in', value: ['somewhat', 'quite_important', 'very_important'] },
      }),
    )
  })
  it('bd questions are invisible until addon selected (end-to-end over the real edge data)', () => {
    const facts: GraphFacts = { answers: {}, selection: { tier: 'standard', level: 'level_1', addon: null } }
    const hidden = computeVisibleSet(PROTECT_DEPENDENCY_EDGES, BD_CODES, facts)
    expect(hidden.size).toBe(0)
    facts.selection.addon = true
    expect(computeVisibleSet(PROTECT_DEPENDENCY_EDGES, BD_CODES, facts).size).toBe(6)
  })
})
