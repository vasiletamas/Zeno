import { describe, it, expect } from 'vitest'
import { runDiagnostics, CHECK_CATALOG } from '@/lib/diagnostics'
import { makeExport, turn } from './export-helpers'

describe('unrendered_ui_action (T29 ratchet)', () => {
  // Ratchet origin: 2026-07-15, conv cmrm3fgku00056g0y4eb2hsme — turns 88/90
  // carried show_document_upload with NO renderer case; the customer was told
  // to use a control that never rendered. That type IS registered/rendered
  // since T29, so the positive case uses a genuinely unregistered type.
  it('flags a recorded uiAction type the renderer has no case for', () => {
    const e = makeExport({ turns: [
      turn(88, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'request_document_upload', args: {}, partition: 'writing', result: { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_fictional_card', payload: {} } } }] }),
    ] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'unrendered_ui_action')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 88, evidence: { type: 'show_fictional_card', tool: 'request_document_upload' } })
  })

  it('is silent for registered types (incl. show_document_upload post-T29) and for results without a uiAction', () => {
    const e = makeExport({ turns: [
      turn(0, { toolCalls: [
        { round: 0, toolCallId: 'x', name: 'write_dnt_answer', args: {}, partition: 'writing', result: { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_question', payload: {} } } },
        { round: 0, toolCallId: 'y', name: 'request_document_upload', args: {}, partition: 'writing', result: { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_document_upload', payload: { kind: 'id_card' } } } },
        { round: 0, toolCallId: 'z', name: 'get_current_state', args: {}, partition: 'readOnly', result: { success: true, durationMs: 5, cached: false } },
      ] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'unrendered_ui_action')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'unrendered_ui_action')).toBe(true)
  })
})
