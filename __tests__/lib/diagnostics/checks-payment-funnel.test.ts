import { describe, it, expect } from 'vitest'
import { runDiagnostics, CHECK_CATALOG } from '@/lib/diagnostics'
import { makeExport, turn } from './export-helpers'

const paymentCall = (mode: string) => ({
  round: 0, toolCallId: 'x', name: 'ensure_payment_session', args: {}, partition: 'writing',
  result: { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_payment', payload: { paymentId: 'p1', mode } } },
})

describe('funnel_ends_at_payment_card (T30 ratchet)', () => {
  // Ratchet origin: 2026-07-15, conv cmrm3fgku00056g0y4eb2hsme — messageIndex
  // 92 emitted show_payment (ensure_payment_session) and NOTHING was recorded
  // after; the Policy only exists because /api/payments/confirm was curl'd
  // manually 4m47s later. Settlement, if any, happened outside the chat.
  it('warns when the highest-messageIndex turn emitted show_payment', () => {
    const e = makeExport({ turns: [
      turn(92, { toolCalls: [paymentCall('started')] }),
      turn(90),
    ] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'funnel_ends_at_payment_card')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'warn', turn: 92, evidence: { tool: 'ensure_payment_session', mode: 'started' } })
  })

  it('is silent when a later turn follows the payment card', () => {
    const e = makeExport({ turns: [
      turn(92, { toolCalls: [paymentCall('retried')] }),
      turn(94),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'funnel_ends_at_payment_card')).toBe(false)
  })

  it('is silent on an export with no turns and on a last turn without show_payment', () => {
    expect(runDiagnostics(makeExport()).some((x) => x.checkId === 'funnel_ends_at_payment_card')).toBe(false)
    const e = makeExport({ turns: [
      turn(3, { toolCalls: [{ round: 0, toolCallId: 'y', name: 'get_current_state', args: {}, partition: 'readOnly', result: { success: true, durationMs: 5, cached: false } }] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'funnel_ends_at_payment_card')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'funnel_ends_at_payment_card')).toBe(true)
  })
})
