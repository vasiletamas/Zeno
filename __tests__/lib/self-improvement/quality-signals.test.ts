import { describe, it, expect } from 'vitest'
import { computeQualitySignals } from '@/lib/self-improvement/quality-signals'
import { makeExport, turn, legality } from '../diagnostics/export-helpers'

// Task 5.5 (D12): the score sees what we now care about — re-asks,
// unexplained tool errors, rejected insights — computed from the SAME
// recorded evidence the diagnostics read.

const ledgerRow = (over: Record<string, unknown>) => ({
  id: 'l1', tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [],
  reasonCode: null, phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY',
  idempotencyDisposition: 'fresh', targetRef: 'field:email', createdAt: '2026-07-06T10:00:00Z', ...over,
})

describe('computeQualitySignals', () => {
  it('counts known-fact re-asks from idempotent replays (the diagnosed conversation scores >= 1)', () => {
    const e = makeExport({ ledger: [
      ledgerRow({ id: 'l1' }),
      ledgerRow({ id: 'l2', idempotencyDisposition: 'replay', createdAt: '2026-07-06T10:05:00Z' }),
    ] })
    expect(computeQualitySignals(e).reaskedKnownFactCount).toBeGreaterThanOrEqual(1)
  })

  it('counts unexplained (never-recovered) tool errors', () => {
    const e = makeExport({ turns: [
      turn(2, { legality: legality({ phase: 'DISCOVERY' }), toolCalls: [
        { round: 0, toolCallId: 'x', name: 'generate_quote', args: {}, partition: 'writing', result: { success: false, error: 'boom', durationMs: 5, cached: false } },
      ] }),
    ] as never })
    expect(computeQualitySignals(e).unexplainedToolErrorCount).toBe(1)
  })

  it('recovered failures do NOT count as unexplained', () => {
    const e = makeExport({ turns: [
      turn(2, { toolCalls: [
        { round: 0, toolCallId: 'x', name: 'generate_quote', args: {}, partition: 'writing', result: { success: false, error: 'boom', durationMs: 5, cached: false } },
        { round: 1, toolCallId: 'y', name: 'generate_quote', args: {}, partition: 'writing', result: { success: true, durationMs: 5, cached: false } },
      ] }),
    ] as never })
    expect(computeQualitySignals(e).unexplainedToolErrorCount).toBe(0)
  })

  it('counts insight_rejected anomalies', () => {
    const e = makeExport({ turns: [
      turn(2, { totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 1, anomalies: [
        { type: 'error_pattern', severity: 'info', message: 'insight_rejected: age=0 failed the typed key spec' },
      ] } }),
    ] as never })
    expect(computeQualitySignals(e).insightRejectedCount).toBe(1)
  })

  it('a clean conversation scores all-zero', () => {
    const e = makeExport({ turns: [turn(0)] as never })
    expect(computeQualitySignals(e)).toEqual({ reaskedKnownFactCount: 0, unexplainedToolErrorCount: 0, insightRejectedCount: 0 })
  })
})
