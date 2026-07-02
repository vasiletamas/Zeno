/**
 * Streaming calls must surface request-time errors (401 auth, connection
 * refused, 5xx) from the AWAITED provider call — not lazily on first
 * iteration of the returned generator.
 *
 * Bug this pins down: all four provider stream methods were `async *`
 * generators, so `await gateway.stream(...)` resolved instantly and the HTTP
 * request only fired inside the orchestrator's `for await` loop — OUTSIDE
 * callWithFailover. Result: no retry, no circuit-breaker accounting, and no
 * cross-provider failover for streaming calls. A primary-provider auth
 * failure (e.g. missing OPENAI_API_KEY) killed every chat turn even though a
 * healthy ANTHROPIC fallback was configured on the agent.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { OpenAIProvider } from '@/lib/llm/providers/openai'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import { callWithFailover } from '@/lib/llm/providers/registry'
import type { StreamChunk, Message } from '@/lib/llm/providers/types'

const messages: Message[] = [{ role: 'user', content: 'hi' }]

function authError(): Error & { status: number } {
  return Object.assign(
    new Error('401 Incorrect API key provided: sk-your-****-key'),
    { status: 401 },
  )
}

/** Minimal OpenAI SDK client stub whose request always rejects with 401. */
function rejectingOpenAIClient() {
  return {
    chat: { completions: { create: vi.fn().mockRejectedValue(authError()) } },
  }
}

/** Minimal Anthropic SDK client stub whose request always rejects with 401. */
function rejectingAnthropicClient() {
  return { messages: { create: vi.fn().mockRejectedValue(authError()) } }
}

/** Anthropic SDK client stub that resolves to a raw SSE event stream. */
function okAnthropicClient(text: string) {
  return {
    messages: {
      create: vi.fn(async () =>
        (async function* () {
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          }
          yield { type: 'message_stop' }
        })(),
      ),
    },
  }
}

beforeAll(() => {
  // Provider constructors only need the env vars to exist.
  process.env.OPENAI_API_KEY ??= 'sk-test'
  process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'
})

describe('provider stream methods surface request errors at call time', () => {
  it('OpenAIProvider.chatStream rejects when the request fails', async () => {
    const provider = new OpenAIProvider()
    provider['client'] = rejectingOpenAIClient() as never
    await expect(
      provider.chatStream({ messages, model: 'gpt-test' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('OpenAIProvider.chatStreamWithTools rejects when the request fails', async () => {
    const provider = new OpenAIProvider()
    provider['client'] = rejectingOpenAIClient() as never
    await expect(
      provider.chatStreamWithTools({ messages, model: 'gpt-test', tools: [] }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('AnthropicProvider.chatStream rejects when the request fails', async () => {
    const provider = new AnthropicProvider()
    provider['client'] = rejectingAnthropicClient() as never
    await expect(
      provider.chatStream({ messages, model: 'claude-test' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('AnthropicProvider.chatStreamWithTools rejects when the request fails', async () => {
    const provider = new AnthropicProvider()
    provider['client'] = rejectingAnthropicClient() as never
    await expect(
      provider.chatStreamWithTools({ messages, model: 'claude-test', tools: [] }),
    ).rejects.toMatchObject({ status: 401 })
  })
})

describe('callWithFailover engages for streaming calls', () => {
  it('fails over to the fallback provider when the primary streaming request 401s', async () => {
    const primary = new OpenAIProvider()
    primary['client'] = rejectingOpenAIClient() as never

    const fallback = new AnthropicProvider()
    fallback['client'] = okAnthropicClient('fallback says hi') as never

    const iterable = await callWithFailover(
      { provider: primary, model: 'gpt-failover-test' },
      { provider: fallback, model: 'claude-failover-test' },
      async (provider, model) =>
        provider.chatStreamWithTools({ messages, model, tools: [] }),
    )

    const chunks: StreamChunk[] = []
    for await (const chunk of iterable) chunks.push(chunk)

    expect(
      chunks.some((c) => c.type === 'content' && c.content === 'fallback says hi'),
    ).toBe(true)
    expect(chunks.some((c) => c.type === 'done')).toBe(true)
  })
})
