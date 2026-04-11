import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSlidingWindow } from '@/lib/chat/sliding-window'

// Mock prisma
vi.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findMany: vi.fn(),
    },
    conversationSummary: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Mock gateway (for summarizer)
vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn().mockResolvedValue({
      content: 'Summary of earlier conversation.',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      rawMessage: { role: 'assistant', content: 'Summary of earlier conversation.' },
    }),
  },
}))

const { prisma } = await import('@/lib/db')

function makeDbMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message number ${i} with some content for token counting`,
    toolCalls: null,
    toolResults: null,
    createdAt: new Date(2026, 0, 1, 0, i),
  }))
}

describe('buildSlidingWindow with token budget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads all messages when total fits within budget', async () => {
    const messages = makeDbMessages(5)
    vi.mocked(prisma.message.findMany).mockResolvedValue(messages as never)

    const result = await buildSlidingWindow('conv-1', 5, 50_000)
    expect(result.messages).toHaveLength(5)
    expect(result.summaryPrefix).toBeNull()
  })

  it('falls back to 20 messages when no budget provided', async () => {
    const messages = makeDbMessages(20)
    vi.mocked(prisma.message.findMany).mockResolvedValue(messages as never)

    const result = await buildSlidingWindow('conv-1', 25)
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    )
  })

  it('limits messages by token budget', async () => {
    const messages = makeDbMessages(10)
    vi.mocked(prisma.message.findMany).mockResolvedValue(messages as never)

    const result = await buildSlidingWindow('conv-1', 10, 50)
    expect(result.messages.length).toBeLessThan(10)
    expect(result.messages.length).toBeGreaterThan(0)
  })
})
