/**
 * gpt-5.6-sol quirk: /v1/chat/completions rejects function tools while
 * reasoning is active (400: "Function tools with reasoning_effort are not
 * supported for gpt-5.6-sol in /v1/chat/completions. To use function tools,
 * use /v1/responses or set reasoning_effort to 'none'."). The model applies
 * a DEFAULT reasoning effort when the param is omitted, so tool-bearing
 * calls must send reasoning_effort: 'none' explicitly. Non-tool calls are
 * unaffected, as are models without the quirk (gpt-5.4 runs tools today).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { OpenAIProvider } from '@/lib/llm/providers/openai'
import type { LLMToolDefinition, Message } from '@/lib/llm/providers/types'

const messages: Message[] = [{ role: 'user', content: 'hi' }]

const tools: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_x',
      description: 'gets x',
      parameters: { type: 'object', properties: {} },
    },
  },
]

beforeAll(() => {
  process.env.OPENAI_API_KEY ??= 'sk-test'
})

/** Non-stream response shape for chat()/chatWithTools(). */
function mockClient() {
  return {
    chat: {
      completions: {
        create: vi.fn(async (params: Record<string, unknown>) => {
          if (params.stream) {
            return (async function* () {
              yield { choices: [{ delta: { content: 'ok' } }] }
              yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
              yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }
            })()
          }
          return {
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }
        }),
      },
    },
  }
}

function lastCreateArgs(client: ReturnType<typeof mockClient>): Record<string, unknown> {
  const calls = client.chat.completions.create.mock.calls
  return calls[calls.length - 1][0] as Record<string, unknown>
}

describe('OpenAI gpt-5.6-sol tools/reasoning quirk', () => {
  it('chatWithTools: gpt-5.6-sol sends reasoning_effort none', async () => {
    const client = mockClient()
    const p = new OpenAIProvider()
    p['client'] = client as never
    await p.chatWithTools({ messages, model: 'gpt-5.6-sol', tools })
    expect(lastCreateArgs(client).reasoning_effort).toBe('none')
  })

  it('chatStreamWithTools: gpt-5.6-sol sends reasoning_effort none', async () => {
    const client = mockClient()
    const p = new OpenAIProvider()
    p['client'] = client as never
    const stream = await p.chatStreamWithTools({ messages, model: 'gpt-5.6-sol', tools })
    for await (const _ of stream) { /* drain */ }
    expect(lastCreateArgs(client).reasoning_effort).toBe('none')
  })

  it('chatWithTools: gpt-5.6-sol overrides an enabled reasoning config (API rejects it with tools)', async () => {
    const client = mockClient()
    const p = new OpenAIProvider()
    p['client'] = client as never
    await p.chatWithTools({
      messages,
      model: 'gpt-5.6-sol',
      tools,
      reasoning: { enabled: true, effort: 'medium' },
    })
    expect(lastCreateArgs(client).reasoning_effort).toBe('none')
  })

  it('chatWithTools: gpt-5.4 is untouched (no reasoning_effort forced)', async () => {
    const client = mockClient()
    const p = new OpenAIProvider()
    p['client'] = client as never
    await p.chatWithTools({ messages, model: 'gpt-5.4', tools })
    expect('reasoning_effort' in lastCreateArgs(client)).toBe(false)
  })

  it('chat: gpt-5.6-sol without tools is untouched (quirk is tools-only)', async () => {
    const client = mockClient()
    const p = new OpenAIProvider()
    p['client'] = client as never
    await p.chat({ messages, model: 'gpt-5.6-sol' })
    expect('reasoning_effort' in lastCreateArgs(client)).toBe(false)
  })
})
