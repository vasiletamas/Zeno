import { describe, it, expect } from 'vitest'
import { buildConversationExport } from '@/lib/debug/conversation-export'
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
  })
})
