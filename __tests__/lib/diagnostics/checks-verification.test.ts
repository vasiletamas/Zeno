import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { makeExport, turn, legality } from './export-helpers'

// Task 4.2 (D7) ratchets: the recorded conversation typed digits into a
// pending challenge and the model re-sent the code instead of confirming.
// These checks make that class impossible to miss again.

const pendingState = { phase: 'QUOTE', identity: { pendingChallenge: { channel: 'email', target: 'm@example.ro' } } }
const noPendingState = { phase: 'QUOTE', identity: { pendingChallenge: null } }

const call = (name: string, args: Record<string, unknown> = {}) =>
  ({ round: 0, toolCallId: 'x', name, args, partition: 'writing', result: { success: true, durationMs: 1, cached: false } })

describe('verification_code_ignored', () => {
  it('errors when the user typed digits into a pending challenge and no confirm call happened', () => {
    const e = makeExport({ turns: [
      turn(4, { userMessage: '483 920', legality: legality(pendingState), toolCalls: [call('get_current_state')] }),
    ] as never })
    const f = runDiagnostics(e).find((x) => x.checkId === 'verification_code_ignored')
    expect(f).toMatchObject({ severity: 'error', turn: 4 })
  })
  it('silent when the turn confirms the code', () => {
    const e = makeExport({ turns: [
      turn(4, { userMessage: '483920', legality: legality(pendingState), toolCalls: [call('confirm_channel_verification', { code: '483920' })] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'verification_code_ignored')).toBe(false)
  })
  it('silent when no challenge is pending (digits can be an answer)', () => {
    const e = makeExport({ turns: [
      turn(4, { userMessage: '5000', legality: legality(noPendingState), toolCalls: [] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'verification_code_ignored')).toBe(false)
  })
})

describe('challenge_resent_while_pending', () => {
  it('warns on a re-send during a live challenge without a customer resend request', () => {
    const e = makeExport({ turns: [
      turn(6, { userMessage: 'am introdus codul dar...', legality: legality(pendingState), toolCalls: [call('start_channel_verification', { channel: 'email', target: 'm@example.ro' })] }),
    ] as never })
    const f = runDiagnostics(e).find((x) => x.checkId === 'challenge_resent_while_pending')
    expect(f).toMatchObject({ severity: 'warn', turn: 6 })
  })
  it('silent when the customer asked for a new code', () => {
    const e = makeExport({ turns: [
      turn(6, { userMessage: 'nu am primit codul, trimite altul', legality: legality(pendingState), toolCalls: [call('start_channel_verification', { channel: 'email', target: 'm@example.ro', resend: true })] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'challenge_resent_while_pending')).toBe(false)
  })
  it('silent when no challenge is pending (first send)', () => {
    const e = makeExport({ turns: [
      turn(3, { userMessage: 'emailul meu este m@example.ro', legality: legality(noPendingState), toolCalls: [call('start_channel_verification', { channel: 'email', target: 'm@example.ro' })] }),
    ] as never })
    expect(runDiagnostics(e).some((x) => x.checkId === 'challenge_resent_while_pending')).toBe(false)
  })
})

describe('known_field_reasked', () => {
  it('warns when collect_customer_field replays idempotently (the agent re-asked a known field)', () => {
    const e = makeExport({ ledger: [
      { id: 'l1', tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'fresh', targetRef: 'field:email', createdAt: '2026-07-06T10:00:00Z' },
      { id: 'l2', tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'DISCOVERY', phaseTo: 'DISCOVERY', idempotencyDisposition: 'replay', targetRef: 'field:email', createdAt: '2026-07-06T10:05:00Z' },
    ] })
    const f = runDiagnostics(e).find((x) => x.checkId === 'known_field_reasked')
    expect(f).toMatchObject({ severity: 'warn', evidence: { targetRef: 'field:email' } })
  })
  it('silent on fresh collects', () => {
    const e = makeExport({ ledger: [
      { id: 'l1', tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: null, phaseTo: null, idempotencyDisposition: 'fresh', targetRef: 'field:email', createdAt: '2026-07-06T10:00:00Z' },
    ] })
    expect(runDiagnostics(e).some((x) => x.checkId === 'known_field_reasked')).toBe(false)
  })
  // A SAME-TURN duplicate is the idempotency layer absorbing a double call
  // within one round-loop — the customer was never re-asked. Only a replay
  // in a LATER turn than the fresh apply is a real re-ask. Attribution
  // anchors on the turn's USER MESSAGE createdAt (same DB clock as the
  // ledger) — replay envelopes carry the ORIGINAL ledgerId, and TurnDebug
  // timestamps are persist-time, so neither joins reliably.
  const collectRow = (id: string, disposition: string, createdAt: string) =>
    ({ id, tool: 'collect_customer_field', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: null, phaseTo: null, idempotencyDisposition: disposition, targetRef: 'field:name', createdAt })
  const userMsgAt = (index: number, createdAt: string) => {
    const arr: unknown[] = []
    arr[index] = { id: `m${index}`, role: 'user', content: 'x', toolCalls: null, toolResults: null, createdAt }
    return arr
  }
  const collectCall = (value: string) =>
    ({ round: 0, toolCallId: 'c1', name: 'collect_customer_field', args: { field: 'name', value }, partition: 'writing', result: { success: true, durationMs: 1, cached: false } })
  it('silent when the fresh apply and the replay land in the SAME turn (round-loop duplicate)', () => {
    const e = makeExport({
      turns: [turn(4, { legality: legality(noPendingState) })] as never,
      ledger: [
        collectRow('l1', 'fresh', '2026-07-06T10:00:01Z'),
        collectRow('l2', 'replay', '2026-07-06T10:00:03Z'),
      ] as never,
    })
    e.messages = userMsgAt(4, '2026-07-06T10:00:00Z') as never
    expect(runDiagnostics(e).some((x) => x.checkId === 'known_field_reasked')).toBe(false)
  })
  it('flags a later-turn replay whose USER MESSAGE re-supplies the value (the customer really was re-asked)', () => {
    const e = makeExport({
      turns: [
        turn(4, { legality: legality(noPendingState) }),
        turn(6, { userMessage: 'Ion Simulescu', toolCalls: [collectCall('Ion Simulescu')], legality: legality(noPendingState) }),
      ] as never,
      ledger: [
        collectRow('l1', 'fresh', '2026-07-06T10:00:01Z'),
        collectRow('l2', 'replay', '2026-07-06T10:00:25Z'),
      ] as never,
    })
    const msgs: unknown[] = userMsgAt(4, '2026-07-06T10:00:00Z')
    msgs[6] = { id: 'm6', role: 'user', content: 'Ion Simulescu', toolCalls: null, toolResults: null, createdAt: '2026-07-06T10:00:20Z' }
    e.messages = msgs as never
    const f = runDiagnostics(e).find((x) => x.checkId === 'known_field_reasked')
    expect(f).toMatchObject({ severity: 'warn', turn: 6, evidence: { targetRef: 'field:name' } })
  })
  it('silent on a later-turn replay when the user message carries no field data (verbatim macro repeat, tracked by idempotent_replay)', () => {
    const e = makeExport({
      turns: [
        turn(4, { legality: legality(noPendingState) }),
        turn(6, { userMessage: 'da', toolCalls: [collectCall('Ion Simulescu')], legality: legality(noPendingState) }),
      ] as never,
      ledger: [
        collectRow('l1', 'fresh', '2026-07-06T10:00:01Z'),
        collectRow('l2', 'replay', '2026-07-06T10:00:25Z'),
      ] as never,
    })
    const msgs: unknown[] = userMsgAt(4, '2026-07-06T10:00:00Z')
    msgs[6] = { id: 'm6', role: 'user', content: 'da', toolCalls: null, toolResults: null, createdAt: '2026-07-06T10:00:20Z' }
    e.messages = msgs as never
    expect(runDiagnostics(e).some((x) => x.checkId === 'known_field_reasked')).toBe(false)
  })
})
