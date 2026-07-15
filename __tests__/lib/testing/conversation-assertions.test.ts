import { describe, it, expect } from 'vitest'
import {
  turnState,
  assertEveryCommitHasLedgerRow,
  assertNoBlockedActionExecuted,
  toolCallsByTurn, assertToolCalled, assertToolNeverCalled, assertToolOrder,
  phaseTimeline, assertNoPhaseRegression, assertNoNarrationViolations, assertNoPremiumBeforeQuote,
} from '@/lib/testing/conversation-assertions'
import type { ConversationExport, CommitLedgerExportRow } from '@/lib/debug/conversation-export'
import type { DebugTurn } from '@/lib/debug/reducer'

function turn(messageIndex: number, extra: Partial<DebugTurn> = {}): DebugTurn {
  return {
    traceId: 't' + messageIndex,
    conversationId: 'conv-1',
    messageIndex,
    userMessage: 'msg ' + messageIndex,
    language: 'ro',
    startedAt: 0,
    toolCalls: [],
    ...extra,
  }
}

function ledgerRow(overrides: Partial<CommitLedgerExportRow> = {}): CommitLedgerExportRow {
  return {
    id: 'l1',
    tool: 'sign_dnt',
    actor: 'agent',
    outcome: 'applied',
    effects: [],
    reasonCode: null,
    phaseFrom: 'APPLICATION',
    phaseTo: 'APPLICATION',
    idempotencyDisposition: 'fresh',
    targetRef: 'dnt_1',
    createdAt: '2026-07-01T10:05:00Z',
    ...overrides,
  }
}

function exp(turns: DebugTurn[], ledger: CommitLedgerExportRow[] = []): ConversationExport {
  return {
    schemaVersion: 2,
    exportedAt: 'x',
    conversationId: 'conv-1',
    conversation: {
      id: 'conv-1', customerId: 'cust-1', productId: null, candidateProductId: null,
      status: 'ACTIVE', language: 'ro', mode: 'SALES', startedAt: 'x', createdAt: 'x',
    },
    summary: { turns: turns.length, messages: 0, toolCalls: 0, toolsUsed: [] },
    messages: [],
    turns,
    ledger,
  }
}

const legalityBase = { engineVersion: '1.33.0', contentVersions: [], snapshot: {} }

describe('turnState (F2.5 — legality-aware)', () => {
  it('prefers the legality snapshot over the legacy gate field', () => {
    const t = turn(0, {
      gate: { skipped: false, durationMs: 0, derivedState: { phase: 'DISCOVERY' } as never },
      legality: [{ ...legalityBase, point: 'turn_start', state: { phase: 'APPLICATION', subphase: 'DNT' } as never, actions: { available: [], blocked: [] } }],
    })
    expect(turnState(t)?.phase).toBe('APPLICATION')
  })

  it('falls back to gate.derivedState for pre-F2 turns, and null when neither exists', () => {
    const t = turn(0, { gate: { skipped: false, durationMs: 0, derivedState: { phase: 'DISCOVERY' } as never } })
    expect(turnState(t)?.phase).toBe('DISCOVERY')
    expect(turnState(turn(1))).toBeNull()
  })
})

describe('assertEveryCommitHasLedgerRow (F2.5, erratum 2 — join via commitLedgerId)', () => {
  it('passes when every post_commit legality entry resolves to a ledger row', () => {
    const t = turn(0, {
      toolCalls: [{ round: 0, toolCallId: '0-0', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }],
      legality: [{ ...legalityBase, point: 'post_commit', commitLedgerId: 'l1', state: {} as never, actions: { available: [], blocked: [] } }],
    })
    expect(() => assertEveryCommitHasLedgerRow(exp([t], [ledgerRow()]))).not.toThrow()
  })

  it('throws naming the tool when a post_commit entry points at a missing ledger row', () => {
    const t = turn(0, {
      toolCalls: [{ round: 0, toolCallId: '0-0', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }],
      legality: [{ ...legalityBase, point: 'post_commit', commitLedgerId: 'ghost', state: {} as never, actions: { available: [], blocked: [] } }],
    })
    expect(() => assertEveryCommitHasLedgerRow(exp([t], [ledgerRow()]))).toThrow(/ghost/)
  })

  it('throws naming the bare tool when a successful writing call has no ledger row at all', () => {
    const t = turn(0, {
      toolCalls: [{ round: 0, toolCallId: '0-0', name: 'accept_quote', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }],
    })
    expect(() => assertEveryCommitHasLedgerRow(exp([t], []))).toThrow(/accept_quote/)
  })

  it('pre-F2 history (no legality) falls back to tool-name-within-conversation', () => {
    const t = turn(0, {
      toolCalls: [{ round: 0, toolCallId: '0-0', name: 'sign_dnt', args: {}, partition: 'writing', result: { success: true, durationMs: 1, cached: false } }],
    })
    expect(() => assertEveryCommitHasLedgerRow(exp([t], [ledgerRow()]))).not.toThrow()
  })
})

const call = (name: string) => ({ round: 0, toolCallId: name, name, args: {}, partition: 'writing' as const, result: { success: true, durationMs: 1, cached: false } })
const gateTurn = (i: number, phase: string, quote: unknown = null) =>
  turn(i, { gate: { skipped: false, durationMs: 0, derivedState: { phase, quote } as never } })

describe('conversation assertions (F1.8 — agent-behavioral layer)', () => {
  it('tool sequence asserts', () => {
    const e = exp([turn(0, { toolCalls: [call('open_dnt_session')] }), turn(1, { toolCalls: [call('write_dnt_answer')] })])
    expect(toolCallsByTurn(e)).toEqual([['open_dnt_session'], ['write_dnt_answer']])
    expect(() => assertToolCalled(e, 'open_dnt_session')).not.toThrow()
    expect(() => assertToolNeverCalled(e, 'sign_dnt')).not.toThrow()
    expect(() => assertToolOrder(e, ['open_dnt_session', 'write_dnt_answer'])).not.toThrow()
    expect(() => assertToolOrder(e, ['write_dnt_answer', 'open_dnt_session'])).toThrow(/order/)
  })
  it('phase timeline + regression', () => {
    const e = exp([gateTurn(0, 'DISCOVERY'), gateTurn(1, 'APPLICATION')])
    expect(phaseTimeline(e)).toEqual(['DISCOVERY', 'APPLICATION'])
    expect(() => assertNoPhaseRegression(e)).not.toThrow()
    const bad = exp([gateTurn(0, 'QUOTE'), gateTurn(1, 'DISCOVERY')])
    expect(() => assertNoPhaseRegression(bad)).toThrow(/regression/)
  })
  it('narration-leak scan reads stored detector verdicts', () => {
    const bad = exp([turn(0, { toolNarration: { violations: [{ category: 'unchecked', matchedPhrase: 'am salvat' }] } as never })])
    expect(() => assertNoNarrationViolations(bad)).toThrow(/narration/)
  })
  it('premium-claim scan flags premium talk before any quote in state', () => {
    const e = exp([gateTurn(0, 'DISCOVERY')])
    e.messages = [{ id: 'm1', role: 'user', content: 'salut', toolCalls: null, toolResults: null, createdAt: 'x' },
      { id: 'm2', role: 'assistant', content: 'Prima ta lunară este 84 lei.', toolCalls: null, toolResults: null, createdAt: 'x' }]
    expect(() => assertNoPremiumBeforeQuote(e)).toThrow(/premium/)
    const ok = exp([gateTurn(0, 'QUOTE', { id: 'q1' })])
    ok.messages = e.messages
    expect(() => assertNoPremiumBeforeQuote(ok)).not.toThrow()
  })
  it('premium-claim scan joins turns by ABSOLUTE message index (D9 semantics): premium talk in the quote turn passes, earlier talk still throws', () => {
    const msg = (i: number, role: 'user' | 'assistant', content: string) =>
      ({ id: 'm' + i, role, content, toolCalls: null, toolResults: null, createdAt: 'x' })
    // turns are keyed by the user message's own index: 0, 2, 4 — quote lands in the third turn
    const ok = exp([gateTurn(0, 'DISCOVERY'), gateTurn(2, 'APPLICATION'), gateTurn(4, 'QUOTE', { id: 'q1' })])
    ok.messages = [
      msg(0, 'user', 'salut'), msg(1, 'assistant', 'buna!'),
      msg(2, 'user', 'vreau o asigurare'), msg(3, 'assistant', 'sigur, cateva intrebari'),
      msg(4, 'user', 'cat costa?'), msg(5, 'assistant', 'Prima ta lunară este 84 lei.'),
    ]
    expect(() => assertNoPremiumBeforeQuote(ok)).not.toThrow()
    const bad = exp([gateTurn(0, 'DISCOVERY'), gateTurn(2, 'QUOTE', { id: 'q1' })])
    bad.messages = [
      msg(0, 'user', 'salut'), msg(1, 'assistant', 'Prima ta lunară este 84 lei.'),
      msg(2, 'user', 'ok'), msg(3, 'assistant', 'super'),
    ]
    expect(() => assertNoPremiumBeforeQuote(bad)).toThrow(/premium/)
  })
})

describe('assertNoBlockedActionExecuted (F2.5)', () => {
  it('flags a ledger commit that was blocked at turn start', () => {
    const t = turn(0, {
      legality: [{ ...legalityBase, point: 'turn_start', state: { phase: 'QUOTE' } as never, actions: { available: [], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' as never }] } }],
    })
    const e = exp([t], [ledgerRow({ id: 'l9', tool: 'accept_quote', phaseFrom: 'QUOTE', phaseTo: 'PAYMENT', targetRef: 'q1' })])
    expect(() => assertNoBlockedActionExecuted(e)).toThrow(/blocked/)
  })

  it('passes when applied commits were all available at turn start', () => {
    const t = turn(0, {
      legality: [{ ...legalityBase, point: 'turn_start', state: {} as never, actions: { available: ['sign_dnt'], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' as never }] } }],
    })
    expect(() => assertNoBlockedActionExecuted(exp([t], [ledgerRow()]))).not.toThrow()
  })

  it('ignores non-applied ledger rows — a rejected attempt is the gateway working', () => {
    const t = turn(0, {
      legality: [{ ...legalityBase, point: 'turn_start', state: {} as never, actions: { available: [], blocked: [{ action: 'accept_quote', reason: 'requires_disclosures' as never }] } }],
    })
    const e = exp([t], [ledgerRow({ tool: 'accept_quote', outcome: 'rejected', reasonCode: 'requires_disclosures' })])
    expect(() => assertNoBlockedActionExecuted(e)).not.toThrow()
  })
})
