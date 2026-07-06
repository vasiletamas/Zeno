import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { makeExport, legality, turn } from './export-helpers'

const postCommit = (commitLedgerId: string, state: Record<string, unknown>) => ({
  point: 'post_commit', engineVersion: 'test-x', contentVersions: [], snapshot: {},
  commitLedgerId, state, actions: { available: [], blocked: [] },
})

describe('envelope/legality diagnostic checks (v2)', () => {
  it('blocked_action_attempted: an applied ledger commit whose tool was blocked at turn start (commitLedgerId join, erratum 3)', () => {
    const e = makeExport({
      turns: [turn(0, { legality: [
        ...legality({ phase: 'QUOTE', quote: { id: 'q1' } }, { available: [], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' }] }),
        postCommit('l1', { phase: 'PAYMENT', schedule: { exists: true } }),
      ] })] as never,
      ledger: [{ id: 'l1', tool: 'accept_quote', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'QUOTE', phaseTo: 'PAYMENT', idempotencyDisposition: 'fresh', targetRef: 'q1', createdAt: 'x' }] as never,
    })
    expect(runDiagnostics(e).find((x) => x.checkId === 'blocked_action_attempted')).toMatchObject({ severity: 'error', evidence: { tool: 'accept_quote', reason: 'requires_disclosures' } })
  })
  it('blocked_action_attempted: NOT flagged when an earlier same-turn commit legitimately unblocked the tool (batched select_coverage → generate_quote)', () => {
    const e = makeExport({
      turns: [turn(0, { legality: [
        ...legality({ phase: 'APPLICATION' }, { available: ['select_coverage'], blocked: [{ action: 'generate_quote', reason: 'selection_incomplete' }] }),
        postCommit('l1', { phase: 'APPLICATION' }),
        postCommit('l2', { phase: 'QUOTE', quote: { id: 'q1' } }),
      ] })] as never,
      ledger: [
        { id: 'l1', tool: 'select_coverage', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'app-1', createdAt: 'x' },
        { id: 'l2', tool: 'generate_quote', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'QUOTE', idempotencyDisposition: 'fresh', targetRef: 'app-1', createdAt: 'x' },
      ] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'blocked_action_attempted')).toBe(false)
  })
  it('blocked_action_attempted: NOT flagged when an earlier same-turn commit unblocked the tool (run cmr99s5cb turn 52)', () => {
    // write_question_answer completes the questionnaire mid-turn; its
    // post_commit snapshot no longer blocks generate_quote, so the later
    // generate_quote commit was legal at call time — turn_start is only the
    // baseline for the FIRST commit of the turn.
    const e = makeExport({
      turns: [turn(0, { legality: [
        ...legality({ phase: 'APPLICATION', application: { id: 'a1' } }, { available: [], blocked: [{ action: 'generate_quote', reason: 'questionnaire_incomplete' }] }),
        { ...postCommit('l1', { phase: 'APPLICATION', application: { id: 'a1' } }), actions: { available: [{ action: 'generate_quote' }], blocked: [] } },
        { ...postCommit('l2', { phase: 'QUOTE', quote: { id: 'q1' } }), actions: { available: [], blocked: [{ action: 'generate_quote', reason: 'already_issued' }] } },
      ] })] as never,
      ledger: [
        { id: 'l1', tool: 'write_question_answer', actor: 'agent', outcome: 'applied', effects: ['advance_phase'], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'a1', createdAt: 'x' },
        { id: 'l2', tool: 'generate_quote', actor: 'agent', outcome: 'applied', effects: ['advance_phase'], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'QUOTE', idempotencyDisposition: 'fresh', targetRef: 'q1', createdAt: 'x' },
      ] as never,
    })
    expect(runDiagnostics(e).filter((x) => x.checkId === 'blocked_action_attempted')).toEqual([])
  })
  it('blocked_action_attempted: NOT flagged for an applied start_channel_verification under a verification_already_pending baseline (the gateway resend escape)', () => {
    // Task 1.1 (D5): an explicit resend:true or a NEW target legally applies
    // while legality lists the tool blocked — verificationResendEscape is the
    // deliberate arg-level hatch the action-level snapshot cannot see.
    const e = makeExport({
      turns: [turn(0, { legality: [
        ...legality({ phase: 'QUOTE', quote: { id: 'q1' } }, { available: [], blocked: [{ action: 'start_channel_verification', reason: 'verification_already_pending' }] }),
        postCommit('l1', { phase: 'QUOTE', quote: { id: 'q1' } }),
      ] })] as never,
      ledger: [{ id: 'l1', tool: 'start_channel_verification', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'QUOTE', phaseTo: 'QUOTE', idempotencyDisposition: 'fresh', targetRef: 'ch-1', createdAt: 'x' }] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'blocked_action_attempted')).toBe(false)
  })
  it('missing_consequences: a successful writing tool call with no ledger row in its conversation', () => {
    const e = makeExport({ turns: [turn(0, { toolCalls: [{ round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }] })] as never, ledger: [] })
    expect(runDiagnostics(e).find((x) => x.checkId === 'missing_consequences')).toMatchObject({ severity: 'error', evidence: { tool: 'sign_dnt' } })
  })
  it('recompute_drift: same-engine-version recomputation disagrees with the stored derivation (opt-in, erratum 2)', () => {
    const drifting = () => ({ state: { phase: 'APPLICATION', application: { id: 'a1' } }, actions: { available: [], blocked: [] } })
    const e = makeExport({ turns: [turn(0, { legality: legality({ phase: 'QUOTE', quote: { id: 'q1' } }) })] as never })
    const f = runDiagnostics(e, undefined, { derive: drifting as never, currentEngineVersion: 'test-x' })
    expect(f.find((x) => x.checkId === 'recompute_drift')?.severity).toBe('error')
    // without recompute options the check never runs (erratum 2: opt-in)
    expect(runDiagnostics(e).some((x) => x.checkId === 'recompute_drift')).toBe(false)
  })
})
