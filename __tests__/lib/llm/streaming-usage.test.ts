/**
 * P1-9: streamed turns recorded 0 tokens, always. OpenAI sends the usage in
 * a FINAL chunk AFTER finish_reason (stream_options.include_usage, choices
 * empty) — but 'done' was yielded AT finish_reason, so usage never landed.
 * The Anthropic stream emitters never read usage at all (message_start
 * carries input_tokens; message_delta carries cumulative output_tokens).
 * Cost monitoring, cache-hit monitoring, and the token anomaly all hung off
 * those zeros.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { OpenAIProvider } from '@/lib/llm/providers/openai'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import type { Message, StreamChunk } from '@/lib/llm/providers/types'

const messages: Message[] = [{ role: 'user', content: 'hi' }]

beforeAll(() => {
  process.env.OPENAI_API_KEY ??= 'sk-test'
  process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test'
})

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const c of stream) out.push(c)
  return out
}

/** OpenAI raw chunk sequence: content -> finish_reason -> TRAILING usage chunk. */
function openAIClientWithTrailingUsage(withToolCall = false) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () =>
          (async function* () {
            if (withToolCall) {
              yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc1', function: { name: 'get_x', arguments: '{}' } }] } }] }
            } else {
              yield { choices: [{ delta: { content: 'salut' } }] }
            }
            yield { choices: [{ delta: {}, finish_reason: withToolCall ? 'tool_calls' : 'stop' }] }
            yield { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
          })(),
        ),
      },
    },
  }
}

/** Anthropic raw event sequence: message_start (input) -> deltas -> message_delta (output) -> message_stop. */
function anthropicClientWithUsage(withToolCall = false) {
  return {
    messages: {
      create: vi.fn(async () =>
        (async function* () {
          yield { type: 'message_start', message: { usage: { input_tokens: 200, output_tokens: 1 } } }
          if (withToolCall) {
            yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc1', name: 'get_x' } }
            yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }
          } else {
            yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'salut' } }
          }
          yield { type: 'message_delta', delta: {}, usage: { output_tokens: 30 } }
          yield { type: 'message_stop' }
        })(),
      ),
    },
  }
}

describe('OpenAI streaming usage (P1-9)', () => {
  it('chatStream: done carries the trailing-chunk usage', async () => {
    const p = new OpenAIProvider()
    p['client'] = openAIClientWithTrailingUsage() as never
    const chunks = await collect(await p.chatStream({ messages, model: 'gpt-test' }))
    const done = chunks.find((c) => c.type === 'done')
    expect(done?.usage).toMatchObject({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
  })
  it('chatStreamWithTools: tool_calls still emitted, done carries usage', async () => {
    const p = new OpenAIProvider()
    p['client'] = openAIClientWithTrailingUsage(true) as never
    const chunks = await collect(await p.chatStreamWithTools({ messages, model: 'gpt-test', tools: [] }))
    expect(chunks.some((c) => c.type === 'tool_calls')).toBe(true)
    expect(chunks.find((c) => c.type === 'done')?.usage).toMatchObject({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })
  })
})

describe('Anthropic streaming usage (P1-9)', () => {
  it('chatStream: done carries input from message_start + output from message_delta', async () => {
    const p = new AnthropicProvider()
    p['client'] = anthropicClientWithUsage() as never
    const chunks = await collect(await p.chatStream({ messages, model: 'claude-test' }))
    expect(chunks.find((c) => c.type === 'done')?.usage).toMatchObject({ promptTokens: 200, completionTokens: 30, totalTokens: 230 })
  })
  it('chatStreamWithTools: tool_calls still emitted, done carries usage', async () => {
    const p = new AnthropicProvider()
    p['client'] = anthropicClientWithUsage(true) as never
    const chunks = await collect(await p.chatStreamWithTools({ messages, model: 'claude-test', tools: [] }))
    expect(chunks.some((c) => c.type === 'tool_calls')).toBe(true)
    expect(chunks.find((c) => c.type === 'done')?.usage).toMatchObject({ promptTokens: 200, completionTokens: 30, totalTokens: 230 })
  })
})
