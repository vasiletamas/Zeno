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
})
