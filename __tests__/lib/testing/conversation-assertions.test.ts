import { describe, it, expect } from 'vitest'
import {
  turnState,
  assertEveryCommitHasLedgerRow,
  assertNoBlockedActionExecuted,
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
