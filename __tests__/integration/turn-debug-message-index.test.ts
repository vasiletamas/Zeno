import { it, expect, beforeEach, vi } from 'vitest'

// Task 5.1 (D9): TurnDebug.messageIndex was persisted AFTER the user and
// assistant saves bumped the counter — every row sat +2 off the message
// array, misattributing every turn in diagnosis. The row must carry the
// index of the USER MESSAGE THAT STARTED THE TURN.

vi.mock('@/lib/llm/providers/registry', async () => {
  const { createMockProvider } = await import('@/__tests__/performance/bench-helpers')
  const provider = createMockProvider({ content: 'Salut! Cu ce te pot ajuta?' })
  return {
    getProvider: () => provider,
    callWithFailover: async (
      _primary: unknown,
      _fallback: unknown,
      fn: (provider: unknown, model: string) => Promise<unknown>,
    ) => fn(provider, 'mock-model'),
  }
})

import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { loadConversationExport } from '@/lib/debug/load-export'

beforeEach(async () => { await resetDb() }, 60000)

async function drainAll(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
}

async function waitForTurnDebugRows(conversationId: string, n: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if ((await prisma.turnDebug.count({ where: { conversationId } })) >= n) return
    await new Promise((r) => setTimeout(r, 250))
  }
}

it('TurnDebug.messageIndex equals the index of the user message that started the turn', async () => {
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })

  await drainAll(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: 'buna', language: 'ro' }))
  await drainAll(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: 'vreau o asigurare', language: 'ro' }))
  await waitForTurnDebugRows(conv.id, 2)

  const messages = await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } })
  const userIndexes = messages.map((m, i) => ({ role: m.role, i })).filter((m) => m.role === 'user').map((m) => m.i)
  expect(userIndexes).toEqual([0, 2])

  const rows = await prisma.turnDebug.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' }, select: { messageIndex: true } })
  expect(rows.map((r) => r.messageIndex)).toEqual(userIndexes)
}, 60000)

it('diagnose cross-reference: the export turn userMessage matches messages[turn.messageIndex]', async () => {
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro' } })

  await drainAll(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: 'buna', language: 'ro' }))
  await drainAll(handleChatTurn({ conversationId: conv.id, customerId: customer.id, message: 'vreau o asigurare', language: 'ro' }))
  await waitForTurnDebugRows(conv.id, 2)

  const bundle = await loadConversationExport(conv.id)
  expect(bundle).not.toBeNull()
  for (const turn of bundle!.turns) {
    const anchored = bundle!.messages[turn.messageIndex]
    expect(anchored.role).toBe('user')
    expect(anchored.content).toBe(turn.userMessage)
  }
}, 60000)
