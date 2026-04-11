import { describe, it, expect, vi } from 'vitest'
import { compactMessages, groupMessages } from '@/lib/chat/compaction'
import type { Message } from '@/lib/llm/providers/types'

// Mock the gateway
vi.mock('@/lib/llm/gateway', () => ({
  gateway: {
    call: vi.fn().mockResolvedValue({
      content: 'Summary: Customer discussed pricing and coverage options.',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      finishReason: 'stop',
      rawMessage: { role: 'assistant', content: 'Summary: Customer discussed pricing and coverage options.' },
    }),
  },
}))

describe('groupMessages', () => {
  it('groups messages into chunks of groupSize', () => {
    const messages: Message[] = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }))
    const groups = groupMessages(messages, 10)
    expect(groups).toHaveLength(3)
    expect(groups[0]).toHaveLength(10)
    expect(groups[1]).toHaveLength(10)
    expect(groups[2]).toHaveLength(5)
  })

  it('returns single group for small arrays', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]
    const groups = groupMessages(messages, 10)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })
})

describe('compactMessages', () => {
  it('compresses oldest groups to cover token deficit', async () => {
    const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Short message number ${i}`,
    }))

    const result = await compactMessages(messages, 500, 'conv-123')

    expect(result.length).toBeLessThan(messages.length)
    expect(result[0].role).toBe('system')
    expect(result[0].content).toContain('Summary')
  })

  it('preserves system messages at the start', async () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are Zeno.' },
      ...Array.from({ length: 15 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `Message ${i}`,
      })),
    ]

    const result = await compactMessages(messages, 500, 'conv-123')

    expect(result[0].role).toBe('system')
    expect(result[0].content).toBe('You are Zeno.')
  })
})
