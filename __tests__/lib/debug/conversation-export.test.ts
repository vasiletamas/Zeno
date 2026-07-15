import { describe, it, expect } from 'vitest'
import { buildConversationExport, EXPORT_SCHEMA_VERSION } from '@/lib/debug/conversation-export'
import type { DebugTurn } from '@/lib/debug/reducer'

function turn(messageIndex: number, toolNames: string[]): DebugTurn {
  return {
    traceId: 't' + messageIndex,
    conversationId: 'conv-1',
    messageIndex,
    userMessage: 'msg ' + messageIndex,
    language: 'ro',
    startedAt: 0,
    toolCalls: toolNames.map((name, i) => ({
      round: 0,
      toolCallId: `${messageIndex}-${i}`,
      name,
      args: {},
      partition: 'writing' as const,
    })),
  }
}

const CONVO = {
  id: 'conv-1',
  customerId: 'cust-1',
  productId: 'p-1',
  candidateProductId: null,
  status: 'ACTIVE',
  language: 'ro',
  mode: 'SALES',
  dntSignedAt: '2026-06-03T00:00:00.000Z',
  dntValidUntil: null,
  startedAt: '2026-06-03T00:00:00.000Z',
  createdAt: '2026-06-03T00:00:00.000Z',
}

const MESSAGES = [
  { id: 'm1', role: 'user', content: 'salut', toolCalls: null, toolResults: null, createdAt: '2026-06-03T00:00:01.000Z' },
  { id: 'm2', role: 'assistant', content: 'buna', toolCalls: null, toolResults: null, createdAt: '2026-06-03T00:00:02.000Z' },
]

describe('buildConversationExport', () => {
  it('orders turns chronologically and summarizes tools + messages', () => {
    const out = buildConversationExport({
      exportedAt: '2026-06-03T12:00:00.000Z',
      conversation: CONVO,
      messages: MESSAGES,
      turns: [
        turn(2, ['generate_quote']),
        turn(0, ['set_candidate_product']),
        turn(1, ['change_selection', 'set_candidate_product']),
      ],
    })

    expect(out.conversationId).toBe('conv-1')
    expect(out.exportedAt).toBe('2026-06-03T12:00:00.000Z')
    expect(out.conversation.mode).toBe('SALES')
    // chronological replay order (DB returns newest-first; export is oldest-first)
    expect(out.turns.map((t) => t.messageIndex)).toEqual([0, 1, 2])
    expect(out.messages).toHaveLength(2)
    expect(out.summary.turns).toBe(3)
    expect(out.summary.messages).toBe(2)
    expect(out.summary.toolCalls).toBe(4) // 1 + 2 + 1
    expect(out.summary.toolsUsed).toEqual(['change_selection', 'generate_quote', 'set_candidate_product'])
  })

  it('handles an empty conversation', () => {
    const out = buildConversationExport({ exportedAt: 'X', conversation: CONVO, messages: [], turns: [] })
    expect(out.summary).toEqual({ turns: 0, messages: 0, toolCalls: 0, toolsUsed: [] })
    expect(out.turns).toEqual([])
    expect(out.messages).toEqual([])
    expect(out.ledger).toEqual([])
  })

  // F2.5 (M8 pin 2): the export is a versioned contract carrying the commit
  // ledger — the ground truth the assertion library joins turns against.
  it('stamps schemaVersion 2 and carries ledger rows sorted by createdAt (M8 pin 2)', () => {
    const out = buildConversationExport({
      exportedAt: 'x',
      conversation: CONVO,
      messages: [],
      turns: [],
      ledger: [
        { id: 'l2', tool: 'sign_dnt', actor: 'agent', outcome: 'applied', effects: ['advance_phase'], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'dnt_1', createdAt: '2026-07-01T10:05:00Z' },
        { id: 'l1', tool: 'open_dnt_session', actor: 'agent', outcome: 'applied', effects: [], reasonCode: null, phaseFrom: 'APPLICATION', phaseTo: 'APPLICATION', idempotencyDisposition: 'fresh', targetRef: 'dnt_1', createdAt: '2026-07-01T10:01:00Z' },
      ],
    })
    expect(out.schemaVersion).toBe(EXPORT_SCHEMA_VERSION)
    expect(out.schemaVersion).toBe(2)
    expect(out.ledger.map((l) => l.id)).toEqual(['l1', 'l2'])
  })
})
