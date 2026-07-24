/**
 * Moonshot AI (Kimi) provider — third first-class vendor alongside OpenAI and
 * Anthropic. Moonshot speaks the OpenAI /v1/chat/completions dialect, so the
 * provider is a thin configuration of OpenAIProvider. These tests pin down the
 * wiring that makes it a real vendor:
 *   1. registry resolves 'MOONSHOT' to a MoonshotProvider singleton
 *   2. the client is pointed at Moonshot's base URL + MOONSHOT_API_KEY
 *   3. MOONSHOT_BASE_URL overrides the region endpoint
 *   4. usage normalization tags cache reads as MOONSHOT (not OPENAI)
 *   5. streaming surfaces request-time errors so gateway failover engages
 *   6. cross-vendor failover works with Moonshot on either side
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { OpenAIProvider } from '@/lib/llm/providers/openai'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import { MoonshotProvider } from '@/lib/llm/providers/moonshot'
import { getProvider, callWithFailover } from '@/lib/llm/providers/registry'
import { parseCacheUsage } from '@/lib/llm/providers/types'
import type { StreamChunk, Message } from '@/lib/llm/providers/types'

const messages: Message[] = [{ role: 'user', content: 'hi' }]

function authError(): Error & { status: number } {
  return Object.assign(new Error('401 Invalid Authentication'), { status: 401 })
}

/** Minimal OpenAI-compatible SDK client stub whose request always rejects with 401. */
function rejectingClient() {
  return { chat: { completions: { create: vi.fn().mockRejectedValue(authError()) } } }
}

/** OpenAI-compatible SDK client stub that resolves to a streamed text response. */
function okStreamingClient(text: string) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () =>
          (async function* () {
            yield { choices: [{ delta: { content: text } }] }
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
            yield {
              choices: [],
              usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
            }
          })(),
        ),
      },
    },
  }
}

beforeAll(() => {
  process.env.OPENAI_API_KEY ??= 'sk-openai-test'
  process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'
  process.env.MOONSHOT_API_KEY ??= 'sk-moonshot-test'
})

afterEach(() => {
  delete process.env.MOONSHOT_BASE_URL
})

// ==============================================
// Registry resolution
// ==============================================

describe('registry resolves MOONSHOT as a first-class vendor', () => {
  it('returns a MoonshotProvider for MOONSHOT (case-insensitive)', () => {
    expect(getProvider('MOONSHOT')).toBeInstanceOf(MoonshotProvider)
    expect(getProvider('moonshot')).toBeInstanceOf(MoonshotProvider)
  })

  it('returns a singleton across calls', () => {
    expect(getProvider('MOONSHOT')).toBe(getProvider('MOONSHOT'))
  })

  it('a MoonshotProvider is an OpenAI-compatible provider', () => {
    // Subclass relationship is the whole point — it reuses OpenAIProvider.
    expect(getProvider('MOONSHOT')).toBeInstanceOf(OpenAIProvider)
  })

  it('lists MOONSHOT in the unknown-provider error', () => {
    expect(() => getProvider('LLAMA')).toThrow(/MOONSHOT/)
  })
})

// ==============================================
// Client wiring: base URL + API key
// ==============================================

describe('MoonshotProvider client wiring', () => {
  it('points the client at Moonshot\'s default base URL', () => {
    const provider = new MoonshotProvider()
    expect(provider['client'].baseURL).toBe('https://api.moonshot.ai/v1')
  })

  it('authenticates with MOONSHOT_API_KEY (not OPENAI_API_KEY)', () => {
    process.env.MOONSHOT_API_KEY = 'sk-moonshot-distinct'
    const provider = new MoonshotProvider()
    expect(provider['client'].apiKey).toBe('sk-moonshot-distinct')
    process.env.MOONSHOT_API_KEY = 'sk-moonshot-test'
  })

  it('honors MOONSHOT_BASE_URL for region/gateway overrides', () => {
    process.env.MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1'
    const provider = new MoonshotProvider()
    expect(provider['client'].baseURL).toBe('https://api.moonshot.cn/v1')
  })
})

// ==============================================
// Usage normalization is tagged MOONSHOT
// ==============================================

describe('MoonshotProvider usage normalization', () => {
  function extract(usage: unknown) {
    const provider = new MoonshotProvider()
    return (provider as unknown as { extractUsage(u: unknown): unknown }).extractUsage(usage)
  }

  it('maps top-level cached_tokens to cacheReadTokens', () => {
    const usage = extract({
      prompt_tokens: 1000,
      completion_tokens: 40,
      total_tokens: 1040,
      cached_tokens: 700,
    }) as { promptTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
    expect(usage.promptTokens).toBe(1000)
    expect(usage.cacheReadTokens).toBe(700)
    expect(usage.cacheWriteTokens).toBe(0)
  })

  it('also tolerates the OpenAI-style nested cached_tokens shape', () => {
    const usage = extract({
      prompt_tokens: 500,
      completion_tokens: 20,
      total_tokens: 520,
      prompt_tokens_details: { cached_tokens: 300 },
    }) as { cacheReadTokens: number }
    expect(usage.cacheReadTokens).toBe(300)
  })

  it('defaults cache fields to 0 when absent', () => {
    const usage = extract({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }) as {
      cacheReadTokens: number
      cacheWriteTokens: number
    }
    expect(usage.cacheReadTokens).toBe(0)
    expect(usage.cacheWriteTokens).toBe(0)
  })
})

describe('parseCacheUsage MOONSHOT branch', () => {
  it('reads a MOONSHOT cache hit', () => {
    expect(parseCacheUsage('MOONSHOT', { cached_tokens: 900 })).toEqual({
      cacheRead: 900,
      cacheWrite: 0,
      cacheHit: true,
    })
  })

  it('reports no hit when there is no cached_tokens', () => {
    expect(parseCacheUsage('MOONSHOT', { prompt_tokens: 100 })).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      cacheHit: false,
    })
  })
})

// ==============================================
// Streaming surfaces request-time errors (failover-critical)
// ==============================================

describe('MoonshotProvider streaming surfaces request errors at call time', () => {
  it('chatStream rejects when the request fails', async () => {
    const provider = new MoonshotProvider()
    provider['client'] = rejectingClient() as never
    await expect(
      provider.chatStream({ messages, model: 'kimi-k2-0711-preview' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('chatStreamWithTools rejects when the request fails', async () => {
    const provider = new MoonshotProvider()
    provider['client'] = rejectingClient() as never
    await expect(
      provider.chatStreamWithTools({ messages, model: 'kimi-k2-0711-preview', tools: [] }),
    ).rejects.toMatchObject({ status: 401 })
  })
})

// ==============================================
// Cross-vendor failover with Moonshot on either side
// ==============================================

describe('callWithFailover engages across OpenAI and Moonshot', () => {
  it('fails over from an OpenAI primary to a Moonshot fallback', async () => {
    const primary = new OpenAIProvider()
    primary['client'] = rejectingClient() as never

    const fallback = new MoonshotProvider()
    fallback['client'] = okStreamingClient('kimi to the rescue') as never

    const iterable = await callWithFailover(
      { provider: primary, model: 'gpt-openai-down' },
      { provider: fallback, model: 'kimi-fallback' },
      async (provider, model) => provider.chatStream({ messages, model }),
    )

    const chunks: StreamChunk[] = []
    for await (const chunk of iterable) chunks.push(chunk)

    expect(chunks.some((c) => c.type === 'content' && c.content === 'kimi to the rescue')).toBe(true)
    expect(chunks.some((c) => c.type === 'done')).toBe(true)
  })

  it('fails over from a Moonshot primary to an Anthropic fallback', async () => {
    const primary = new MoonshotProvider()
    primary['client'] = rejectingClient() as never

    const fallback = new AnthropicProvider()
    fallback['client'] = {
      messages: {
        create: vi.fn(async () =>
          (async function* () {
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'claude backup' } }
            yield { type: 'message_stop' }
          })(),
        ),
      },
    } as never

    const iterable = await callWithFailover(
      { provider: primary, model: 'kimi-primary-down' },
      { provider: fallback, model: 'claude-fallback' },
      async (provider, model) => provider.chatStream({ messages, model }),
    )

    const chunks: StreamChunk[] = []
    for await (const chunk of iterable) chunks.push(chunk)

    expect(chunks.some((c) => c.type === 'content' && c.content === 'claude backup')).toBe(true)
  })
})
