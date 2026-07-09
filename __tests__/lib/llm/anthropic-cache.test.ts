import { describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import type { Message } from '@/lib/llm/providers/types'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {}
    messages = { create: vi.fn(), stream: vi.fn() }
  },
}))

describe('AnthropicProvider cache hint handling', () => {
  // Access the private convertMessages via type assertion
  function getConverter() {
    const provider = new AnthropicProvider()
    return (provider as any).convertMessages.bind(provider)
  }

  it('creates separate system blocks for cached and non-cached messages', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'system', content: 'Stable prefix', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'system', content: 'Dynamic suffix' },
      { role: 'user', content: 'Hello' },
    ]
    const result = convert(messages)

    expect(result.system).toHaveLength(2)
    expect(result.system[0].text).toBe('Stable prefix')
    expect(result.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(result.system[1].text).toBe('Dynamic suffix')
    expect(result.system[1]).not.toHaveProperty('cache_control')
  })

  it('backward compat: single system message without hint gets cache_control', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'system', content: 'Full prompt' },
      { role: 'user', content: 'Hello' },
    ]
    const result = convert(messages)

    expect(result.system).toHaveLength(1)
    expect(result.system[0].text).toBe('Full prompt')
    expect(result.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('single system message WITH hint gets cache_control from hint', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'system', content: 'Cached prompt', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'user', content: 'Hello' },
    ]
    const result = convert(messages)

    expect(result.system).toHaveLength(1)
    expect(result.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('multiple system messages all with hints — each gets its own block', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'system', content: 'Block 1', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'system', content: 'Block 2', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'system', content: 'Block 3' },
      { role: 'user', content: 'Hello' },
    ]
    const result = convert(messages)

    expect(result.system).toHaveLength(3)
    expect(result.system[0].cache_control).toBeDefined()
    expect(result.system[1].cache_control).toBeDefined()
    expect(result.system[2]).not.toHaveProperty('cache_control')
  })

  // D1 (plan 2026-07-06): history breakpoint — a cacheHint on a NON-system
  // message becomes cache_control on that message's last content block, so
  // the conversation history reads from cache while the per-turn state rides
  // the final (uncached) user message.
  it('user message with cacheHint gets a cache_control text block', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'system', content: 'Stable' },
      { role: 'user', content: 'question', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'next question' },
    ]
    const result = convert(messages)

    const first = result.messages[0]
    expect(first.role).toBe('user')
    expect(Array.isArray(first.content)).toBe(true)
    expect((first.content as any[])[0]).toMatchObject({
      type: 'text',
      text: 'question',
      cache_control: { type: 'ephemeral' },
    })
    // uncached messages keep plain string content
    expect(typeof result.messages[1].content).toBe('string')
  })

  it('assistant message with cacheHint gets a cache_control text block', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', cacheHint: { breakpoint: 'ephemeral' } },
      { role: 'user', content: 'q2' },
    ]
    const result = convert(messages)

    const assistant = result.messages[1]
    expect(Array.isArray(assistant.content)).toBe(true)
    expect((assistant.content as any[])[0]).toMatchObject({
      type: 'text',
      text: 'a',
      cache_control: { type: 'ephemeral' },
    })
  })

  it('assistant message with toolCalls and cacheHint puts cache_control on the last block', () => {
    const convert = getConverter()
    const messages: Message[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'calling',
        toolCalls: [{ id: 't1', name: 'list_products', arguments: {} }],
        cacheHint: { breakpoint: 'ephemeral' },
      },
      { role: 'user', content: 'q2' },
    ]
    const result = convert(messages)

    const blocks = result.messages[1].content as any[]
    expect(blocks[blocks.length - 1]).toMatchObject({
      type: 'tool_use',
      cache_control: { type: 'ephemeral' },
    })
  })
})
