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

describe('stale_card_replayed (2026-07-20 ratchet)', () => {
  // Ratchet origin: conv cmrrhruba0001g40yh3am7peo turn 12 — the gateway
  // replayed turn 10's stored envelope verbatim, re-emitting a phone card
  // computed against dead state. Effects replay; cards must not.
  const replayLedgerRow = (tool: string, createdAt: string) => ({
    id: 'L1', tool, actor: 'agent', outcome: 'applied', effects: [], reasonCode: null,
    phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'replay',
    targetRef: 'field:residency', createdAt,
  })
  const cardResult = { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_data_field', payload: { field: 'phone' } } }

  it('flags a card-bearing toolCall in a turn window containing a same-tool replay ledger row', () => {
    const e = makeExport({
      turns: [turn(12, {
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [{ round: 1, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'residency', value: 'Romania' }, partition: 'writing', result: cardResult }],
      })] as never,
      ledger: [replayLedgerRow('collect_customer_field', '2026-07-19T08:27:53.738Z')] as never,
    })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'stale_card_replayed')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 12, evidence: { tool: 'collect_customer_field', cardType: 'show_data_field' } })
  })

  it('is silent when a same-tool call carries no card, or a card-bearing call\'s tool has no matching replay row', () => {
    const e = makeExport({
      turns: [turn(12, {
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [
          { round: 0, toolCallId: 'a', name: 'collect_customer_field', args: { field: 'phone', value: '07' }, partition: 'writing', result: { success: true, durationMs: 5, cached: false } },
          { round: 1, toolCallId: 'b', name: 'get_product_info', args: {}, partition: 'readOnly', result: cardResult },
        ],
      })] as never,
      ledger: [
        replayLedgerRow('collect_customer_field', '2026-07-19T08:20:00.000Z'),
        replayLedgerRow('set_candidate_product', '2026-07-19T08:27:53.000Z'),
      ] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'stale_card_replayed')).toBe(false)
  })

  // Pins the window-floor semantics: a turn's own startedAt/endedAt are both
  // stamped at persist time (see the implementation comment) and cannot
  // bound anything on their own — the floor is the PRECEDING turn's endedAt.
  // These two two-turn fixtures fail if the floor reverts to t.startedAt
  // (T2, since startedAt===endedAt in real data) or the window is dropped
  // entirely (all ledger rows considered regardless of turn).
  it('a same-tool replay row created BEFORE the preceding turn (10) ended belongs to turn 10\'s window, not turn 12\'s — no finding', () => {
    const T1 = Date.parse('2026-07-19T08:20:00.000Z')
    const T2 = Date.parse('2026-07-19T08:27:56.000Z')
    const e = makeExport({
      turns: [
        turn(10, { startedAt: T1, endedAt: T1, toolCalls: [] }),
        turn(12, {
          startedAt: T2, endedAt: T2,
          toolCalls: [{ round: 1, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'residency', value: 'Romania' }, partition: 'writing', result: cardResult }],
        }),
      ] as never,
      // createdAt is BEFORE T1 — belongs to turn 10's window (floor 0..T1), not turn 12's (floor T1..T2)
      ledger: [replayLedgerRow('collect_customer_field', '2026-07-19T08:15:00.000Z')] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'stale_card_replayed')).toBe(false)
  })

  it('positive complement: the same row created BETWEEN turn 10\'s and turn 12\'s endedAt DOES flag turn 12', () => {
    const T1 = Date.parse('2026-07-19T08:20:00.000Z')
    const T2 = Date.parse('2026-07-19T08:27:56.000Z')
    const e = makeExport({
      turns: [
        turn(10, { startedAt: T1, endedAt: T1, toolCalls: [] }),
        turn(12, {
          startedAt: T2, endedAt: T2,
          toolCalls: [{ round: 1, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'residency', value: 'Romania' }, partition: 'writing', result: cardResult }],
        }),
      ] as never,
      // createdAt is BETWEEN T1 and T2 — belongs to turn 12's window
      ledger: [replayLedgerRow('collect_customer_field', '2026-07-19T08:23:00.000Z')] as never,
    })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'stale_card_replayed')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 12, evidence: { tool: 'collect_customer_field', cardType: 'show_data_field' } })
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'stale_card_replayed')).toBe(true)
  })
})

describe('card_for_committed_fact (2026-07-20 ratchet)', () => {
  const appliedRow = (targetRef: string, createdAt: string, disposition = 'fresh') => ({
    id: `L-${targetRef}-${createdAt}`, tool: 'collect_customer_field', actor: 'gui', outcome: 'applied', effects: [],
    reasonCode: null, phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: disposition,
    targetRef, createdAt,
  })
  const phoneCardCall = (id: string) => ({ round: 1, toolCallId: id, name: 'collect_customer_field',
    args: { field: 'residency', value: 'Romania' }, partition: 'writing',
    result: { success: true, durationMs: 5, cached: false, uiAction: { type: 'show_data_field', payload: { field: 'phone' } } } })

  it('flags a data-field card for a field with an earlier applied commit', () => {
    const e = makeExport({
      turns: [turn(12, { startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [phoneCardCall('x')] })] as never,
      ledger: [appliedRow('field:phone', '2026-07-19T08:27:51.410Z')] as never,
    })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'card_for_committed_fact')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'error', turn: 12, evidence: { cardField: 'phone' } })
  })

  it('is silent when the field commit happens AFTER the emitting turn (legit ladder progression)', () => {
    const e = makeExport({
      turns: [turn(8, { startedAt: Date.parse('2026-07-19T08:06:00.000Z'), endedAt: Date.parse('2026-07-19T08:06:10.000Z'),
        toolCalls: [phoneCardCall('y')] })] as never,
      ledger: [appliedRow('field:phone', '2026-07-19T08:27:51.410Z')] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'card_for_committed_fact')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'card_for_committed_fact')).toBe(true)
  })
})

describe('competing_input_cards (2026-07-20 ratchet)', () => {
  const call = (id: string, name: string, type: string) => ({ round: 0, toolCallId: id, name, args: {}, partition: 'writing',
    result: { success: true, durationMs: 5, cached: false, uiAction: { type, payload: {} } } })

  it('flags a turn emitting two input-type cards (conv cmrrhruba turn 8: data_field + otp)', () => {
    const e = makeExport({ turns: [turn(8, { toolCalls: [
      call('a', 'collect_customer_field', 'show_data_field'),
      call('b', 'start_channel_verification', 'show_otp_entry'),
    ] })] as never })
    const f = runDiagnostics(e).filter((x) => x.checkId === 'competing_input_cards')
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'warn', turn: 8, evidence: { types: ['show_data_field', 'show_otp_entry'] } })
  })

  it('is silent for one input card, or an input card + a non-input card (quote)', () => {
    const e = makeExport({ turns: [turn(2, { toolCalls: [
      call('a', 'write_dnt_answer', 'show_question'),
      call('b', 'generate_quote', 'show_quote'),
    ] })] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'competing_input_cards')).toBe(false)
  })

  it('is registered in the catalog', () => {
    expect(CHECK_CATALOG.some((c) => c.id === 'competing_input_cards')).toBe(true)
  })
})
