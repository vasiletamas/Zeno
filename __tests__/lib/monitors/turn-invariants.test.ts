import { describe, it, expect } from 'vitest'
import { evaluateTurnInvariants } from '@/lib/monitors/turn-invariants'

const base = {
  briefingRecommendedActions: [], availableActions: [],
  executorRejections: [], writingToolResults: [], ledgerDispositions: [], confirmTokenReissues: 0,
}
describe('evaluateTurnInvariants (F2.4, T14.D3 — mechanical @contract subset)', () => {
  it('briefing-integrity: a recommended action missing from available_actions is CRITICAL (the live 10-tool regression class)', () => {
    const f = evaluateTurnInvariants({ ...base, briefingRecommendedActions: ['open_dnt_session'], availableActions: ['get_dnt_state'] })
    expect(f).toEqual([{ code: 'briefing_action_not_exposed', severity: 'critical', detail: { actions: ['open_dnt_session'] } }])
  })
  it('executor rejection of a non-exposed tool is a WARNING with the tool named', () => {
    const f = evaluateTurnInvariants({ ...base, executorRejections: [{ tool: 'generate_quote', reason: 'not_exposed' }] })
    expect(f[0]).toMatchObject({ code: 'executor_rejected_tool', severity: 'warning' })
  })
  it('a writing tool result without a commit envelope is CRITICAL', () => {
    const f = evaluateTurnInvariants({ ...base, writingToolResults: [{ tool: 'sign_dnt', hasEnvelope: false }] })
    expect(f[0]).toMatchObject({ code: 'envelope_missing', severity: 'critical', detail: { tools: ['sign_dnt'] } })
  })
  it('idempotent replays and confirm-token reissues are INFO counters', () => {
    const f = evaluateTurnInvariants({ ...base, ledgerDispositions: ['fresh', 'replay'], confirmTokenReissues: 1 })
    expect(f.map((x) => x.code).sort()).toEqual(['confirm_token_reissued', 'idempotent_replay'])
    expect(f.every((x) => x.severity === 'info')).toBe(true)
  })
  it('a clean turn yields no findings', () => {
    expect(evaluateTurnInvariants(base)).toEqual([])
  })
})
