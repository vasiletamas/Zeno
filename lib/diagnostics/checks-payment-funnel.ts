/**
 * Payment-funnel diagnostic checks (T30). Ratchet origin: 2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme — messageIndex 92 emitted show_payment
 * (ensure_payment_session) and nothing was recorded after; the Policy only
 * exists because /api/payments/confirm was curl'd manually 4m47s later.
 * A conversation whose LAST recorded turn shows the payment card means
 * settlement, if any, happened outside the chat.
 */
import type { DiagnosticCheck, Finding } from './types'

export const funnelEndsAtPaymentCard: DiagnosticCheck = {
  id: 'funnel_ends_at_payment_card',
  description: 'The payment card was the last recorded event — settlement, if any, happened outside the chat (T30, 2026-07-15)',
  run: (e) => {
    if (e.turns.length === 0) return []
    const last = e.turns.reduce((a, b) => (b.messageIndex > a.messageIndex ? b : a))
    return last.toolCalls.flatMap((c): Finding[] => {
      const uiAction = c.result?.uiAction as { type?: unknown; payload?: { mode?: unknown } } | undefined
      if (uiAction?.type !== 'show_payment') return []
      return [{ checkId: 'funnel_ends_at_payment_card', severity: 'warn', turn: last.messageIndex, evidence: { tool: c.name, mode: uiAction.payload?.mode } }]
    })
  },
}
