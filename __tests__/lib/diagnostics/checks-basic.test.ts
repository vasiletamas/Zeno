import { describe, it, expect } from 'vitest'
import { runDiagnostics, CHECK_CATALOG } from '@/lib/diagnostics'
import { makeExport, legality, turn } from './export-helpers'

describe('basic diagnostic checks', () => {
  it('tool_call_failed flags an unrecovered error-carrying failure as ERROR', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: false, durationMs: 5, cached: false, error: 'boom' } }] })] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'tool_call_failed')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 0, evidence: { tool: 'sign_dnt', error: 'boom' } })
  })
  it('tool_call_failed downgrades to WARN when the same tool later succeeds (validation bounce, recovered)', () => {
    const e = makeExport({ turns: [
      turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'write_dnt_answer', args: {}, partition: 'writing', result: { success: false, durationMs: 5, cached: false, error: 'Invalid option' } }] }),
      turn(1, { toolCalls: [{ round: 0, toolCallId: 'y', name: 'write_dnt_answer', args: {}, partition: 'writing', result: { success: true, durationMs: 5, cached: false } }] }),
    ] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'tool_call_failed')).toMatchObject({ severity: 'warn', evidence: { recovered: true } })
  })
  it('tool_call_failed ignores domain non-applies (success=false without an error)', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: false, durationMs: 5, cached: false, data: { preview: {} } } }] })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'tool_call_failed')).toBe(false)
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
  it('anomalies_reported relays persisted turn anomalies with a 1:1 severity map', () => {
    const e = makeExport({ turns: [turn(0, { totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 1, anomalies: [
      { type: 'behavioral', severity: 'critical', message: 'briefing_action_not_exposed', metadata: {} },
      { type: 'error_pattern', severity: 'warning', message: '3 tool failures in this turn', metadata: {} },
      { type: 'error_pattern', severity: 'info', message: 'LLM retry detected for agent "main-chat"', metadata: {} },
    ] } })] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'anomalies_reported')
    expect(f.map((x) => x.severity)).toEqual(['error', 'warn', 'info'])
  })
  it('a clean conversation yields zero findings and the catalog is closed over unique ids', () => {
    expect(runDiagnostics(makeExport({ turns: [turn(0)] as never }))).toEqual([])
    const ids = CHECK_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
