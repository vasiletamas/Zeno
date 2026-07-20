/**
 * P0-1 diagnostics ratchet: fabrications and false state claims can never
 * pass silently. questionnaire_answer_fabricated extends the narrow DNT
 * numeric check to ALL value-writing commits via the shared grounding
 * module; state_claim_without_commit catches "am corectat..." prose in
 * turns that committed nothing (the recorded lie of run cmr940u78).
 */
import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { makeExport, turn } from './export-helpers'

const write = (name: string, args: Record<string, unknown>) =>
  ({ round: 0, toolCallId: 'x', name, args, partition: 'writing', result: { success: true, durationMs: 1, cached: false } })

const msg = (role: 'user' | 'assistant', content: string) => ({ role, content }) as never

describe('questionnaire_answer_fabricated', () => {
  it('flags a numeric application answer with no anchor in the customer messages', () => {
    const e = makeExport({
      messages: [msg('assistant', 'Câți membri are familia ta?'), msg('user', 'da'), msg('assistant', 'Te rog un număr.'), msg('user', 'da')],
      turns: [turn(3, { userMessage: 'da', toolCalls: [write('write_question_answer', { answer: '2', questionCode: 'FAMILY_SIZE' })] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'questionnaire_answer_fabricated')).toMatchObject({ severity: 'warn', evidence: { tool: 'write_question_answer', value: '2' } })
  })
  it('stays silent when the customer said the number', () => {
    const e = makeExport({
      messages: [msg('user', 'suntem 2 in familie')],
      turns: [turn(0, { userMessage: 'suntem 2 in familie', toolCalls: [write('write_question_answer', { answer: '2' })] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'questionnaire_answer_fabricated')).toBe(false)
  })
  it('flags an email the customer never uttered (collect_customer_field)', () => {
    const e = makeExport({
      messages: [msg('user', 'da, continuam')],
      turns: [turn(0, { userMessage: 'da, continuam', toolCalls: [write('collect_customer_field', { field: 'email', value: 'invented@example.com' })] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'questionnaire_answer_fabricated')).toMatchObject({ severity: 'warn', evidence: { tool: 'collect_customer_field', value: 'invented@example.com' } })
  })
  it('an ISO date grounded by the CNP the customer typed is not flagged', () => {
    const e = makeExport({
      messages: [msg('user', 'cnp 1960229410015')],
      turns: [turn(0, { userMessage: 'cnp 1960229410015', toolCalls: [write('collect_customer_field', { field: 'dateOfBirth', value: '1996-02-29' })] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'questionnaire_answer_fabricated')).toBe(false)
  })
  it('a value successfully written in an EARLIER turn is not re-flagged (re-collect of the same email, run cmr9eli9n)', () => {
    const e = makeExport({
      messages: [msg('user', 'emailul meu e ion.sim@example.com'), msg('assistant', 'salvat'), msg('user', 'da'), msg('assistant', 'ok'), msg('user', 'da'), msg('assistant', 'ok'), msg('user', 'da'), msg('assistant', 'ok'), msg('user', 'da'), msg('assistant', 'ok'), msg('user', 'da'), msg('assistant', 'ok'), msg('user', 'da'), msg('assistant', 'ok'), msg('user', 'da')],
      turns: [
        turn(0, { userMessage: 'emailul meu e ion.sim@example.com', toolCalls: [write('collect_customer_field', { field: 'email', value: 'ion.sim@example.com' })] }),
        turn(14, { userMessage: 'da', toolCalls: [write('collect_customer_field', { field: 'email', value: 'ion.sim@example.com' })] }),
      ] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'questionnaire_answer_fabricated')).toBe(false)
  })

  it('enum tokens are OUT of diagnostics scope (options are not exported; the write-guard owns them)', () => {
    const e = makeExport({
      messages: [msg('user', 'din salariu')],
      turns: [turn(0, { userMessage: 'din salariu', toolCalls: [write('write_dnt_answer', { questionCode: 'DNT_INCOME_SOURCE', value: 'salary_pension' })] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'questionnaire_answer_fabricated')).toBe(false)
  })
})

describe('state_claim_without_commit', () => {
  it('flags an action claim in a turn that committed nothing (the "am corectat" lie)', () => {
    const e = makeExport({
      messages: [msg('user', 'corecteaza te rog consimtamantul de marketing'), msg('assistant', 'Am corectat răspunsul — consimțământul de marketing este acum NU.')],
      turns: [turn(0, { userMessage: 'corecteaza te rog consimtamantul de marketing', toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'state_claim_without_commit')).toMatchObject({ severity: 'warn' })
  })
  it('stays silent when the claiming turn carries a successful writing commit', () => {
    const e = makeExport({
      messages: [msg('user', 'schimba pe NU'), msg('assistant', 'Am corectat răspunsul — este acum NU.')],
      turns: [turn(0, { userMessage: 'schimba pe NU', toolCalls: [write('modify_answer', { questionCode: 'X', newValue: 'nu' })] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'state_claim_without_commit')).toBe(false)
  })
  it('benign prose without action-claim verbs is never flagged', () => {
    const e = makeExport({
      messages: [msg('user', 'ok'), msg('assistant', 'Oferta rămâne valabilă până pe 5 august.')],
      turns: [turn(0, { userMessage: 'ok', toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'state_claim_without_commit')).toBe(false)
  })
})

describe('gui-actor exemption (2026-07-20)', () => {
  it('does not flag a value committed by the gui actor (card submit), even when prose only shows a mask', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: '⟦action⟧✓ Telefon: ***607', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Mulțumesc.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, {
        userMessage: '⟦action⟧✓ Telefon: ***607',
        // Real persisted shape: TurnDebug stamps startedAt === endedAt at
        // reduction time, AFTER the turn's mid-turn ledger writes — so the
        // gui row (08:27:51.410) sits BEFORE this instant. A floor reverted
        // to t.startedAt would exclude it and resurrect the turn-12
        // masked-phone false positive; this fixture kills that mutant.
        startedAt: Date.parse('2026-07-19T08:27:56.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [{ round: 0, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'phone', value: '0735226607' }, partition: 'writing',
          result: { success: true, durationMs: 5, cached: false } }],
      })] as never,
      ledger: [{ id: 'L1', tool: 'collect_customer_field', actor: 'gui', outcome: 'applied', effects: [], reasonCode: null,
        phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'fresh', targetRef: 'field:phone',
        createdAt: '2026-07-19T08:27:51.410Z' }] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'questionnaire_answer_fabricated')).toBe(false)
  })

  it('still flags an agent-actor value with no anchor (net intact)', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'buna', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'ok', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, {
        userMessage: 'buna',
        startedAt: Date.parse('2026-07-19T08:27:50.000Z'), endedAt: Date.parse('2026-07-19T08:27:56.000Z'),
        toolCalls: [{ round: 0, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'phone', value: '0735226607' }, partition: 'writing',
          result: { success: true, durationMs: 5, cached: false } }],
      })] as never,
      ledger: [{ id: 'L1', tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null,
        phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'fresh', targetRef: 'field:phone',
        createdAt: '2026-07-19T08:27:51.410Z' }] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'questionnaire_answer_fabricated')).toBe(true)
  })

  // Pins the window-CEILING/turn-scoping semantics: a gui-actor commit from
  // an EARLIER turn must not exempt a collect in a LATER turn — fails if the
  // window is dropped entirely. (The floor-revert mutant is killed by the
  // startedAt===endedAt fixture in the first exemption test above.)
  it('the exemption is scoped to THIS turn\'s window — a gui row from an earlier turn (two-turn fixture) does not exempt a later collect', () => {
    const T1 = Date.parse('2026-07-19T08:06:10.000Z')
    const T2 = Date.parse('2026-07-19T08:27:56.000Z')
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'buna', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'ok', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [
        turn(8, { startedAt: T1, endedAt: T1, toolCalls: [] }),
        turn(12, {
          userMessage: 'buna',
          startedAt: T2, endedAt: T2,
          toolCalls: [{ round: 0, toolCallId: 'x', name: 'collect_customer_field', args: { field: 'phone', value: '0735226607' }, partition: 'writing',
            result: { success: true, durationMs: 5, cached: false } }],
        }),
      ] as never,
      // gui row createdAt is BEFORE T1 — belongs to turn 8's window, not turn 12's
      ledger: [{ id: 'L1', tool: 'collect_customer_field', actor: 'gui', outcome: 'applied', effects: [], reasonCode: null,
        phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'fresh', targetRef: 'field:phone',
        createdAt: '2026-07-19T08:00:00.000Z' }] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'questionnaire_answer_fabricated')).toBe(true)
  })
})
