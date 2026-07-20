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

describe('unsolicited_contact_card (2026-07-19 ratchet)', () => {
  // Ratchet origin: conv cmrrhruba0001g40yh3am7peo turn 6 — the agent saved
  // the conversationally-asked declaredAge, the handler auto-advanced the
  // contact ladder and pushed an email card while the assistant prose asked
  // about residency. The customer saw a contact demand unrelated to the
  // question. T28 made declaredAge/residency/name/dob/cnp non-ladder saves,
  // so a ladder card may only ride a LADDER save.
  const collect = (id: string, field: string, result: Record<string, unknown>) =>
    ({ round: 0, toolCallId: id, name: 'collect_customer_field', args: { field, value: 'v' }, partition: 'writing', result: { success: true, durationMs: 5, cached: false, ...result } })
  const emailCard = { type: 'show_data_field', payload: { field: 'email', label: { en: 'Email address', ro: 'Adresa de email' } } }

  it('flags a contact card emitted by a non-ladder save (declaredAge → email card)', () => {
    const e = makeExport({ turns: [
      turn(6, { toolCalls: [collect('x', 'declaredAge', { uiAction: emailCard })] }),
    ] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'unsolicited_contact_card')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 6, evidence: { savedField: 'declaredAge', cardField: 'email' } })
  })

  it('is silent for ladder progression (email save → phone card), cardless saves, and failed collects', () => {
    const e = makeExport({ turns: [
      turn(2, { toolCalls: [collect('a', 'email', { uiAction: { type: 'show_data_field', payload: { field: 'phone' } } })] }),
      turn(4, { toolCalls: [collect('b', 'declaredAge', {})] }),
      turn(8, { toolCalls: [collect('c', 'residency', { success: false })] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'unsolicited_contact_card')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'unsolicited_contact_card')).toBe(true)
  })
})
