import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { trigramSimilarity } from '@/lib/diagnostics/checks-behavioral'
import { makeExport, legality, turn } from './export-helpers'

describe('behavioral diagnostic checks', () => {
  it('briefing_tool_not_exposed relays the persisted F2.4 monitor anomaly with its actions (erratum 1)', () => {
    const e = makeExport({ turns: [turn(0, {
      legality: legality({ phase: 'APPLICATION', application: { id: 'a1' } }, { available: ['get_dnt_state'], blocked: [] }),
      totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 1, anomalies: [
        { type: 'behavioral', severity: 'critical', message: 'briefing_action_not_exposed', metadata: { actions: ['open_dnt_session'] } },
      ] },
    })] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'briefing_tool_not_exposed')).toMatchObject({ severity: 'error', evidence: { actions: ['open_dnt_session'] } })
  })
  it('funnel_stalled: >=4 consecutive turns, same phase, zero commits', () => {
    const turns = [0, 1, 2, 3].map((i) => turn(i, { legality: legality({ phase: 'APPLICATION', application: { id: 'a1' } }) }))
    const f = runDiagnostics(makeExport({ turns: turns as never, ledger: [] })).find((x) => x.checkId === 'funnel_stalled')
    expect(f).toMatchObject({ severity: 'warn', evidence: { fromTurn: 0, toTurn: 3, phase: 'APPLICATION' } })
  })
  it('funnel_stalled stays quiet when a commit lands inside the window', () => {
    const turns = [0, 1, 2, 3].map((i) => turn(i, {
      legality: i === 2
        ? [...legality({ phase: 'APPLICATION', application: { id: 'a1' } }), { point: 'post_commit', engineVersion: 'test-x', contentVersions: [], snapshot: {}, commitLedgerId: 'l1', state: { phase: 'APPLICATION', application: { id: 'a1' } }, actions: { available: [], blocked: [] } }]
        : legality({ phase: 'APPLICATION', application: { id: 'a1' } }),
    }))
    expect(runDiagnostics(makeExport({ turns: turns as never })).some((x) => x.checkId === 'funnel_stalled')).toBe(false)
  })
  it('state_snapshot_inconsistent: phase QUOTE while state.quote is null', () => {
    const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'QUOTE', quote: null }) })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'state_snapshot_inconsistent')).toBe(true)
  })
  it('latency_outlier: latencyMs > 30000', () => {
    const e = makeExport({ turns: [turn(0, { totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 31000, anomalies: [] } })] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'latency_outlier')?.severity).toBe('warn')
  })
  it('repeated_assistant_message: consecutive assistant messages with trigram similarity > 0.85 (deflection-loop class)', () => {
    const m = (id: string, content: string) => ({ id, role: 'assistant', content, toolCalls: null, toolResults: null, createdAt: 'x' })
    const e = makeExport({ messages: [m('1', 'Vrei să îți explic pachetul Standard sau Optim?'), m('2', 'Vrei să îți explic pachetul Standard sau Optim?')] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'repeated_assistant_message')).toBe(true)
    expect(trigramSimilarity('abcdef', 'abcdef')).toBe(1)
    expect(trigramSimilarity('abcdef', 'zzzzzz')).toBe(0)
  })
  it('ended_pre_closing: conversation ending while phase is pre-PAYMENT is INFO', () => {
    const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'APPLICATION', application: { id: 'a1' } }) })] as never })
    expect(runDiagnostics(e).find((x) => x.checkId === 'ended_pre_closing')?.severity).toBe('info')
  })
})
