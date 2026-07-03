import { describe, it, expect } from 'vitest'
import { runDiagnostics, CHECK_CATALOG } from '@/lib/diagnostics'
import type { ConversationExport } from '@/lib/debug/conversation-export'

export function makeExport(over: Partial<ConversationExport> = {}): ConversationExport {
  return { schemaVersion: 2, exportedAt: 'x', conversationId: 'c1',
    conversation: { id: 'c1', status: 'ACTIVE' } as never,
    summary: { turns: 0, messages: 0, toolCalls: 0, toolsUsed: [] },
    messages: [], turns: [], ledger: [], ...over } as never
}
export const legality = (state: Record<string, unknown>, actions: { available: string[]; blocked: { action: string; reason: string }[] } = { available: [], blocked: [] }) =>
  [{ point: 'turn_start', engineVersion: 'test-x', contentVersions: [], snapshot: {}, state, actions }]
export const turn = (i: number, over: Record<string, unknown> = {}) => ({
  traceId: `t${i}`, conversationId: 'c1', messageIndex: i, userMessage: 'u', language: 'ro',
  startedAt: 0, endedAt: 1, toolCalls: [], totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 900, anomalies: [] }, ...over,
}) as never

describe('basic diagnostic checks', () => {
  it('tool_call_failed flags a failed tool result with turn + tool evidence', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: false, durationMs: 5, cached: false, error: 'boom' } }] })] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'tool_call_failed')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 0, evidence: { tool: 'sign_dnt', error: 'boom' } })
  })
  it('tool_call_without_result flags a call missing its result', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'get_dnt_state', args: {}, partition: 'readOnly' }] })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'tool_call_without_result')).toBe(true)
  })
  it('turn_not_ended flags a turn without endedAt/totals', () => {
    const e = makeExport({ turns: [turn(0, { endedAt: undefined, totals: undefined })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'turn_not_ended')).toBe(true)
  })
  it('phase_regression flags POLICY -> QUOTE without a cancelling commit', () => {
    const e = makeExport({ turns: [
      turn(0, { legality: legality({ phase: 'POLICY', policy: { id: 'p1' } }) }),
      turn(1, { legality: legality({ phase: 'QUOTE', quote: { id: 'q1' } }) }),
    ] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'phase_regression')).toMatchObject({ severity: 'error', turn: 1 })
  })
  it('duplicate_turn_debug flags two turns with the same messageIndex', () => {
    const e = makeExport({ turns: [turn(0), turn(0)] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'duplicate_turn_debug')).toBe(true)
  })
  it('anomalies_reported relays persisted turn anomalies', () => {
    const e = makeExport({ turns: [turn(0, { totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 1, anomalies: [{ type: 'behavioral', severity: 'critical', message: 'briefing_action_not_exposed', metadata: {} }] } })] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'anomalies_reported')?.severity).toBe('error')
  })
  it('a clean conversation yields zero findings and the catalog is closed over unique ids', () => {
    expect(runDiagnostics(makeExport({ turns: [turn(0)] as never }))).toEqual([])
    const ids = CHECK_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
