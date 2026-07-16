/**
 * UI-surface diagnostic checks (T29). Ratchet origin: 2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme — request_document_upload emitted
 * show_document_upload at turns 88/90, rich-content had no case, and the
 * customer was told to use a control that never rendered. Any recorded
 * uiAction whose type the renderer does not know is that incident class.
 */
import type { DiagnosticCheck, Finding } from './types'
import { RENDERED_UI_ACTION_TYPES } from '@/lib/chat/ui-action-registry'

export const unrenderedUiAction: DiagnosticCheck = {
  id: 'unrendered_ui_action',
  description: 'A tool emitted a uiAction type the renderer has no case for — the customer saw nothing (T29, 2026-07-15)',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.flatMap((c): Finding[] => {
    const type = (c.result?.uiAction as { type?: unknown } | undefined)?.type
    if (typeof type !== 'string' || RENDERED_UI_ACTION_TYPES.includes(type)) return []
    return [{ checkId: 'unrendered_ui_action', severity: 'error', turn: t.messageIndex, evidence: { type, tool: c.name } }]
  })),
}
