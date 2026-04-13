import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildSlidingWindow, updateSummaryIfStale } from '@/lib/chat/sliding-window'

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
      content: 'Fresh summary from LLM.',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: 'stop',
      rawMessage: { role: 'assistant', content: 'Fresh summary from LLM.' },
    }),
  },
}))

const { prisma } = await import('@/lib/db')
const { gateway } = await import('@/lib/llm/gateway')

function makeDbMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message number ${i} with some content for token counting`,
    toolCalls: null,
    toolResults: null,
    createdAt: new Date(2026, 0, 1, 0, i),
  }))
}

describe('Proactive summarizer — stale-while-revalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses stale summary immediately without blocking on gateway.call', async () => {
    // 30 total messages, window loads last 20 → 10 older messages need summary
    const allMessages = makeDbMessages(30)
    const windowMessages = allMessages.slice(-20)

    // First call: load desc window messages
    vi.mocked(prisma.message.findMany).mockResolvedValueOnce(windowMessages as never)

    // Existing stale summary: covers only first 5 messages (gap = 10 - 5 = 5, but we care about stale threshold)
    vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue({
      id: 'sum-1',
      conversationId: 'conv-1',
      summary: 'Stale summary text from earlier.',
      messagesUpTo: 5,
      tokenCount: 50,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const result = await buildSlidingWindow('conv-1', 30)

    // Should return the stale summary immediately
    expect(result.summaryPrefix).toBe('Stale summary text from earlier.')
    // Should NOT have called gateway.call synchronously (background refresh may fire, but not blocking)
    expect(gateway.call).not.toHaveBeenCalled()
  })

  it('blocks on summarizer only when no summary exists at all', async () => {
    const allMessages = makeDbMessages(30)
    const windowMessages = allMessages.slice(-20)
    const olderMessages = allMessages.slice(0, 10)

    // First call: load desc window messages
    vi.mocked(prisma.message.findMany)
      .mockResolvedValueOnce(windowMessages as never)
      // Second call: load older messages for summarizer
      .mockResolvedValueOnce(olderMessages as never)

    // No existing summary
    vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue(null)

    const result = await buildSlidingWindow('conv-1', 30)

    // Should have called gateway.call synchronously to generate summary
    expect(gateway.call).toHaveBeenCalledWith('summarizer', expect.any(Object))
    expect(result.summaryPrefix).toBe('Fresh summary from LLM.')
  })

  it('updateSummaryIfStale triggers refresh when gap exceeds threshold', async () => {
    // Summary covers up to message 10, current count is 25 → gap = 15 > STALE_MESSAGE_THRESHOLD (10)
    vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue({
      id: 'sum-1',
      conversationId: 'conv-1',
      summary: 'Old summary.',
      messagesUpTo: 10,
      tokenCount: 50,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    // Mock message loading for incremental refresh
    vi.mocked(prisma.message.findMany).mockResolvedValue(
      makeDbMessages(15).map((m, i) => ({ ...m, content: `New message ${i}` })) as never,
    )

    await updateSummaryIfStale('conv-1', 25)

    // Wait a tick for the background promise to resolve
    await new Promise((r) => setTimeout(r, 50))

    // Should have called gateway with incremental summarization prompt
    expect(gateway.call).toHaveBeenCalledWith(
      'summarizer',
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Old summary.'),
          }),
        ]),
      }),
    )
  })

  it('updateSummaryIfStale does nothing when summary is fresh', async () => {
    // Summary covers up to message 20, current count is 22 → gap = 2, under threshold
    vi.mocked(prisma.conversationSummary.findUnique).mockResolvedValue({
      id: 'sum-1',
      conversationId: 'conv-1',
      summary: 'Recent summary.',
      messagesUpTo: 20,
      tokenCount: 50,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    await updateSummaryIfStale('conv-1', 22)

    // Wait a tick
    await new Promise((r) => setTimeout(r, 50))

    // Should NOT call gateway — summary is fresh
    expect(gateway.call).not.toHaveBeenCalled()
  })
})
