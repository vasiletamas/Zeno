import { describe, it, expect } from 'vitest'
import { getToolDefinition, listCommitTools } from '@/lib/tools/registry'
import { PROTECT_DEPENDENCY_EDGES } from '@/prisma/seeds/seed-dependency-edges'

/**
 * C1.ADD-1 (G2, T13.D1): the questionnaire tool surface carries the PINNED
 * names — get_next_question (R, structured branching provenance),
 * write_question_answer (C), modify_answer (C) — and the legacy names are
 * gone. C1.ADD-2 (G3, T13.D7): check_bd_eligibility retired; the bd rule
 * lives as ELIGIBILITY edges in the graph.
 */
describe('questionnaire tool surface (pinned names)', () => {
  it('get_next_question is a read; write_question_answer and modify_answer are commits', () => {
    expect(getToolDefinition('get_next_question')?.kind).toBe('read')
    expect(getToolDefinition('write_question_answer')?.kind).toBe('commit')
    expect(getToolDefinition('modify_answer')?.kind).toBe('commit')
    const commits = listCommitTools()
    expect(commits).toContain('write_question_answer')
    expect(commits).toContain('modify_answer')
    expect(commits).not.toContain('get_next_question')
  })

  it('save_application_answer and set_answer are retired', () => {
    expect(getToolDefinition('save_application_answer')).toBeUndefined()
    expect(getToolDefinition('set_answer')).toBeUndefined()
  })
})

describe('check_bd_eligibility retirement (C1.ADD-2)', () => {
  it('the tool is gone; the bd rule lives as ELIGIBILITY edges in the graph', () => {
    expect(getToolDefinition('check_bd_eligibility')).toBeUndefined()
    const bdEdges = PROTECT_DEPENDENCY_EDGES.filter(
      (e) => e.kind === 'ELIGIBILITY' && e.subjectKey === 'selection:addon' && e.dependsOnKey.startsWith('answer:BD_'),
    )
    expect(bdEdges).toHaveLength(6)
  })
})
