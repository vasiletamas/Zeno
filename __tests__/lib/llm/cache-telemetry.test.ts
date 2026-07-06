/**
 * Cache telemetry must survive usage normalization (plan 2026-07-06 A1, F8).
 *
 * Bug this pins down: both providers normalized usage to
 * { promptTokens, completionTokens, totalTokens } and DROPPED the raw cache
 * fields, so the gateway's cache:status event — which parsed raw provider
 * keys off the already-normalized object — has emitted zeros since it
 * shipped. Additionally the Anthropic streaming paths emitted `done` with no
 * usage at all, so on fallback even token counts were zero.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { OpenAIProvider } from '@/lib/llm/providers/openai'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import { cacheUsageFromTokens } from '@/lib/llm/gateway'
import type { StreamChunk } from '@/lib/llm/providers/types'

beforeAll(() => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key'
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key'
})

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const c of iterable) chunks.push(c)
  return chunks
}

// ==============================================
// OpenAI usage normalization
// ==============================================

describe('OpenAIProvider extractUsage cache fields', () => {
  function extract(usage: unknown) {
    const provider = new OpenAIProvider()
    return (provider as any).extractUsage(usage)
  }

  it('maps prompt_tokens_details.cached_tokens to cacheReadTokens', () => {
    const usage = extract({
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      prompt_tokens_details: { cached_tokens: 800 },
    })
    expect(usage.promptTokens).toBe(1000)
    expect(usage.cacheReadTokens).toBe(800)
    expect(usage.cacheWriteTokens).toBe(0)
  })

  it('defaults cache fields to 0 when details are absent', () => {
    const usage = extract({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 })
    expect(usage.cacheReadTokens).toBe(0)
    expect(usage.cacheWriteTokens).toBe(0)
  })
})

// ==============================================
// Anthropic usage normalization
// ==============================================

describe('AnthropicProvider extractUsage cache fields', () => {
  function extract(usage: unknown) {
    const provider = new AnthropicProvider()
    return (provider as any).extractUsage(usage)
  }

  it('maps cache_read/cache_creation input tokens', () => {
    const usage = extract({
      input_tokens: 200,
      output_tokens: 40,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 120,
    })
    expect(usage.promptTokens).toBe(200)
    expect(usage.completionTokens).toBe(40)
    expect(usage.cacheReadTokens).toBe(3000)
    expect(usage.cacheWriteTokens).toBe(120)
  })

  it('defaults cache fields to 0 when absent', () => {
    const usage = extract({ input_tokens: 200, output_tokens: 40 })
    expect(usage.cacheReadTokens).toBe(0)
    expect(usage.cacheWriteTokens).toBe(0)
  })
})

// ==============================================
// Anthropic streaming usage (was: none at all)
// ==============================================

function anthropicStreamEvents(withTool: boolean) {
  return (async function* () {
    yield {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 150,
          output_tokens: 1,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 90,
        },
      },
    }
    if (withTool) {
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'list_products' },
      }
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      }
    } else {
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Bună!' },
      }
    }
    yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } }
    yield { type: 'message_stop' }
  })()
}

describe('AnthropicProvider streaming emits usage on done', () => {
  it('chatStream path: done chunk carries accumulated usage incl. cache fields', async () => {
    const provider = new AnthropicProvider()
    const chunks = await collect((provider as any).emitStreamChunks(anthropicStreamEvents(false)))
    const done = chunks.find((c) => c.type === 'done')
    expect(done?.usage).toBeDefined()
    expect(done!.usage!.promptTokens).toBe(150)
    expect(done!.usage!.completionTokens).toBe(25)
    expect(done!.usage!.cacheReadTokens).toBe(2000)
    expect(done!.usage!.cacheWriteTokens).toBe(90)
    expect(done!.usage!.totalTokens).toBe(175)
  })

  it('chatStreamWithTools path: done chunk carries accumulated usage', async () => {
    const provider = new AnthropicProvider()
    const chunks = await collect(
      (provider as any).emitStreamWithToolsChunks(anthropicStreamEvents(true)),
    )
    const done = chunks.find((c) => c.type === 'done')
    expect(done?.usage).toBeDefined()
    expect(done!.usage!.promptTokens).toBe(150)
    expect(done!.usage!.completionTokens).toBe(25)
    expect(done!.usage!.cacheReadTokens).toBe(2000)
    expect(done!.usage!.cacheWriteTokens).toBe(90)
    // tool_calls still emitted before done
    expect(chunks.some((c) => c.type === 'tool_calls')).toBe(true)
  })
})

// ==============================================
// Gateway: CacheUsage from normalized TokenUsage
// ==============================================

describe('cacheUsageFromTokens', () => {
  it('derives cache usage from normalized fields', () => {
    expect(
      cacheUsageFromTokens({ promptTokens: 100, completionTokens: 5, totalTokens: 105, cacheReadTokens: 80, cacheWriteTokens: 5 }),
    ).toEqual({ cacheRead: 80, cacheWrite: 5, cacheHit: true })
  })

  it('handles absent cache fields as zeros / no hit', () => {
    expect(
      cacheUsageFromTokens({ promptTokens: 100, completionTokens: 5, totalTokens: 105 }),
    ).toEqual({ cacheRead: 0, cacheWrite: 0, cacheHit: false })
  })
})
