/**
 * UI-surface diagnostic checks (T29). Ratchet origin: 2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme — request_document_upload emitted
 * show_document_upload at turns 88/90, rich-content had no case, and the
 * customer was told to use a control that never rendered. Any recorded
 * uiAction whose type the renderer does not know is that incident class.
 */
import type { DiagnosticCheck, Finding } from './types'
import { RENDERED_UI_ACTION_TYPES } from '@/lib/chat/ui-action-registry'
import { FIELD_ORDER } from '@/lib/tools/handlers/data-handlers'

/**
 * Ratchet origin: 2026-07-19, conv cmrrhruba0001g40yh3am7peo turn 6 — the
 * agent recorded the conversationally-asked declaredAge and the handler's
 * unconditional ladder auto-advance pushed an email card while the prose
 * asked about residency. T28 made declaredAge/residency/name/dob/cnp
 * NON-ladder saves, so a contact card may only ride a LADDER save.
 */
export const unsolicitedContactCard: DiagnosticCheck = {
  id: 'unsolicited_contact_card',
  description: 'collect_customer_field saved a non-ladder field yet emitted the next contact card — the customer saw an email/phone demand unrelated to the question asked (2026-07-19, conv cmrrhruba turn 6)',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.flatMap((c): Finding[] => {
    if (c.name !== 'collect_customer_field') return []
    const ui = c.result?.uiAction as { type?: unknown; payload?: { field?: unknown } } | undefined
    if (ui?.type !== 'show_data_field') return []
    const savedField = (c.args as { field?: unknown } | undefined)?.field
    if (typeof savedField === 'string' && (FIELD_ORDER as readonly string[]).includes(savedField)) return []
    return [{ checkId: 'unsolicited_contact_card', severity: 'error', turn: t.messageIndex, evidence: { savedField, cardField: ui.payload?.field } }]
  })),
}

export const unrenderedUiAction: DiagnosticCheck = {
  id: 'unrendered_ui_action',
  description: 'A tool emitted a uiAction type the renderer has no case for — the customer saw nothing (T29, 2026-07-15)',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.flatMap((c): Finding[] => {
    const type = (c.result?.uiAction as { type?: unknown } | undefined)?.type
    if (typeof type !== 'string' || RENDERED_UI_ACTION_TYPES.includes(type)) return []
    return [{ checkId: 'unrendered_ui_action', severity: 'error', turn: t.messageIndex, evidence: { type, tool: c.name } }]
  })),
}

/** Ledger rows inside a turn's [startedAt, endedAt] window (ledger createdAt
 * is ISO, turn bounds are epoch ms). Small windows; O(n·m) is fine. */
const ledgerRowsInTurn = (
  ledger: { tool: string; idempotencyDisposition: string; createdAt: string }[] | undefined,
  t: { startedAt: number; endedAt?: number },
) => (ledger ?? []).filter((r) => {
  const at = Date.parse(r.createdAt)
  return at >= t.startedAt && at <= (t.endedAt ?? Number.MAX_SAFE_INTEGER)
})

/**
 * Ratchet origin: 2026-07-20, conv cmrrhruba0001g40yh3am7peo turn 12 — an
 * idempotent replay returned the stored envelope verbatim, re-emitting a
 * show_data_field(phone) card computed when phone was genuinely missing.
 * A replay confirms a fact; it must never deliver a card.
 *
 * Verified against the live row (conv cmrrhruba, all 33 turns): TurnDebug
 * persistence (lib/chat/turn-debug-persistence.ts) reduces the whole turn's
 * event list in one synchronous pass, so startedAt and endedAt are BOTH
 * Date.now() calls a fraction of a millisecond apart — every turn in this
 * conversation has startedAt === endedAt (or a 1ms jitter), and that single
 * instant lands AFTER the turn's own mid-turn ledger writes (turn 12: ledger
 * createdAt 08:27:53.738Z, recorded startedAt/endedAt 08:27:55.920Z — 2.18s
 * later). t.startedAt is therefore not a usable lower bound. Turns ARE
 * strictly sequential (endedAt strictly increasing turn-to-turn), so the
 * preceding turn's endedAt is used as the window floor instead.
 */
export const staleCardReplayed: DiagnosticCheck = {
  id: 'stale_card_replayed',
  description: 'A replayed commit\'s result carried a uiAction — a card computed against dead state was re-delivered (2026-07-20, conv cmrrhruba turn 12)',
  run: (e) => {
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    return ordered.flatMap((t, i) => {
      const windowFloor = (ordered[i - 1] as { endedAt?: number } | undefined)?.endedAt ?? 0
      const replays = ledgerRowsInTurn(e.ledger, { startedAt: windowFloor, endedAt: (t as { endedAt?: number }).endedAt })
        .filter((r) => r.idempotencyDisposition === 'replay')
      if (replays.length === 0) return []
      return t.toolCalls.flatMap((c): Finding[] => {
        const type = (c.result?.uiAction as { type?: unknown } | undefined)?.type
        if (typeof type !== 'string') return []
        if (!replays.some((r) => r.tool === c.name)) return []
        return [{ checkId: 'stale_card_replayed', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name, cardType: type } }]
      })
    })
  },
}

/**
 * Ratchet origin: 2026-07-20, conv cmrrhruba turn 12 — a phone card was
 * emitted two seconds AFTER an applied field:phone commit in the same turn.
 * A show_data_field card whose field already has an applied collect commit
 * at (or before) the emitting turn's end is demanding a known fact.
 */
export const cardForCommittedFact: DiagnosticCheck = {
  id: 'card_for_committed_fact',
  description: 'A show_data_field card asked for a field that already had an applied commit at emission time (2026-07-20, conv cmrrhruba turn 12)',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.flatMap((c): Finding[] => {
    const ui = c.result?.uiAction as { type?: unknown; payload?: { field?: unknown } } | undefined
    if (ui?.type !== 'show_data_field' || typeof ui.payload?.field !== 'string') return []
    const field = ui.payload.field
    const turnEnd = (t as { endedAt?: number }).endedAt ?? Number.MAX_SAFE_INTEGER
    const committed = (e.ledger ?? []).some((r) =>
      r.tool === 'collect_customer_field' && r.outcome === 'applied' &&
      r.idempotencyDisposition === 'fresh' && r.targetRef === `field:${field}` &&
      Date.parse(r.createdAt) <= turnEnd)
    if (!committed) return []
    return [{ checkId: 'card_for_committed_fact', severity: 'error', turn: t.messageIndex, evidence: { cardField: field, tool: c.name } }]
  })),
}
