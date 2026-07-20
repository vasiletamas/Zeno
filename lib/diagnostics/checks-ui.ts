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
