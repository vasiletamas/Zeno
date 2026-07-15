import { describe, it, expect } from 'vitest'
import { buildBranchingMetadata } from '@/lib/engines/branching-provenance'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'
import type { GraphFacts } from '@/lib/engines/dependency-graph'

const facts: GraphFacts = { answers: {}, selection: { tier: 'standard', level: 'level_1', addon: true } }
const texts = { BD_CANCER_HISTORY: { en: 'Cancer history?', ro: 'Istoric de cancer?' } }
const gateTexts = {} // selection gates carry no question text

describe('buildBranchingMetadata', () => {
  it('reports which edge fired, on which value, and whether the question was added by the last commit', () => {
    const meta = buildBranchingMetadata({
      graph: PROTECT_DEPENDENCY_EDGES,
      questionCode: 'BD_CANCER_HISTORY',
      facts,
      questionTexts: { ...texts, ...gateTexts },
      lastCommitQuestionsAdded: ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR'],
      groupCode: 'bd_medical',
      groupName: { en: 'BD Medical', ro: 'BD Medical' },
    })
    expect(meta.triggeredBy).toContainEqual(expect.objectContaining({
      nodeKey: 'selection:addon', kind: 'VISIBILITY', matchedValue: 'true', predicate: { op: 'is_true' },
    }))
    expect(meta.addedByLastCommit).toBe(true)
    expect(meta.groupCode).toBe('bd_medical')
  })
  it('ungated question → empty triggeredBy, addedByLastCommit false', () => {
    const meta = buildBranchingMetadata({
      graph: PROTECT_DEPENDENCY_EDGES, questionCode: 'HEALTH_DECLARATION_CONFIRM', facts,
      questionTexts: {}, lastCommitQuestionsAdded: [], groupCode: 'application', groupName: { en: 'Application', ro: 'Aplicație' },
    })
    expect(meta.triggeredBy).toEqual([])
    expect(meta.addedByLastCommit).toBe(false)
  })
})
