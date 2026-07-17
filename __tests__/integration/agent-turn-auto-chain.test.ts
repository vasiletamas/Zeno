/**
 * T19 (P3.4): _autoChain executes on the AGENT tool-loop path too. T8 wired
 * the single hop for synthetic/gui turns only; the consent travels with the
 * SUBMISSION regardless of actor — a customer who types their email in prose
 * (agent-actor collect_customer_field) has authorized the send exactly like
 * a card submit, so the chained start_channel_verification must run in the
 * same turn instead of the model asking "trimit codul...?" (conv
 * cmrm3fgku00056g0y4eb2hsme messageIndex 66-74).
 *
 * Seams mocked (T13 harness): gateway.stream (scripted rounds, per-call
 * message snapshots), executeToolWithPipeline (applied envelopes, records the
 * actor), loadDomainSnapshot (fixture). Everything else — the loop, the hop
 * wiring, seeding, refresh — runs real against the test DB.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { Message, LLMToolDefinition } from '@/lib/llm/providers/types'

const h = vi.hoisted(() => ({
  snapshot: null as unknown,
  streamCalls: [] as { agentSlug: string; options: { messages: Message[]; tools?: LLMToolDefinition[] } }[],
  streamScript: [] as { content?: string; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] }[],
  pipelineCalls: [] as { name: string; actor: string | undefined }[],
  collectOutcome: 'applied' as 'applied' | 'requires_confirmation',
}))

vi.mock('@/lib/llm/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/gateway')>()
  return {
    ...actual,
    gateway: {
      stream: vi.fn(async (agentSlug: string, options: { messages: Message[]; tools?: LLMToolDefinition[] }) => {
        // snapshot the messages array — the orchestrator mutates it in place
        h.streamCalls.push({ agentSlug, options: { ...options, messages: [...options.messages] } })
        const script = h.streamScript.shift()
        return (async function* () {
          if (script?.toolCalls) yield { type: 'tool_calls', toolCalls: script.toolCalls }
          if (script?.content) yield { type: 'content', content: script.content }
          yield { type: 'done', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
        })()
      }),
      // summarizer / compliance / insights side calls — benign canned reply
      call: vi.fn(async () => ({
        content: '{"passed":true,"gaps":[],"suggestions":[]}',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        rawMessage: { role: 'assistant', content: '' },
      })),
    },
  }
})

vi.mock('@/lib/engines/snapshot-loader', () => ({
  loadDomainSnapshot: vi.fn(async () => JSON.parse(JSON.stringify(h.snapshot))),
}))

vi.mock('@/lib/tools/pipeline', () => ({
  executeToolWithPipeline: vi.fn(async (name: string, _args: Record<string, unknown>, ctx: { actor?: string }) => {
    h.pipelineCalls.push({ name, actor: ctx.actor })
    if (name === 'collect_customer_field') {
      const chainDecl = { tool: 'start_channel_verification', args: { channel: 'email', target: 'x@y.ro' } }
      const data = { _message: 'Contact saved.', _autoChain: chainDecl }
      if (h.collectOutcome === 'requires_confirmation') {
        return {
          toolResult: {
            success: false,
            data,
            envelope: { outcome: 'requires_confirmation', effects: [], confirmToken: 'tok-1', data },
          },
        }
      }
      return {
        toolResult: {
          success: true,
          data,
          envelope: { outcome: 'applied', effects: [], ledgerId: 'led-collect', data },
        },
      }
    }
    if (name === 'start_channel_verification') {
      // the hop declares its OWN _autoChain — the single-hop cap must ignore it
      const data = { _message: 'Verification code sent.', _autoChain: { tool: 'generate_quote', args: {} } }
      return {
        toolResult: {
          success: true,
          data,
          envelope: { outcome: 'applied', effects: [], ledgerId: 'led-send', data },
          uiAction: { type: 'show_otp_entry', payload: { channel: 'email', targetMasked: 'x***@y.ro', target: 'x@y.ro' } },
        },
      }
    }
    return {
      toolResult: {
        success: true,
        data: {},
        envelope: { outcome: 'applied', effects: [], ledgerId: `led-${name}` },
      },
    }
  }),
}))

import { prisma } from '@/lib/db'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { makeSnapshot } from '@/__tests__/lib/engines/snapshot-fixtures'
import { VALID_DNT } from '@/__tests__/spec/helpers/spec-snapshots'
import { seedAgents } from '@/prisma/seeds/seed-agents'
import { resetFunnelTables } from '../helpers/test-db'

const snapshot = () => makeSnapshot({
  consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
  dnt: VALID_DNT,
  identity: { tier: 'anonymous', fields: {}, verifiedChannels: [], pendingChallenge: null },
})

async function drainEvents(stream: ReadableStream<Uint8Array>): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: { event: string; data: Record<string, unknown> }[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const event = raw.match(/^event: (.+)$/m)?.[1]
      const data = raw.match(/^data: (.+)$/m)?.[1]
      if (event && data) {
        try { events.push({ event, data: JSON.parse(data) }) } catch { /* non-JSON */ }
      }
    }
  }
  return events
}

async function makeConversation(): Promise<{ conversationId: string; customerId: string }> {
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })
  return { conversationId: conv.id, customerId: customer.id }
}

describe('agent-path _autoChain single hop (T19)', () => {
  beforeAll(async () => { await seedAgents(prisma) })

  beforeEach(async () => {
    await resetFunnelTables()
    h.snapshot = snapshot()
    h.streamCalls.length = 0
    h.streamScript.length = 0
    h.pipelineCalls.length = 0
    h.collectOutcome = 'applied'
  }, 60000)

  it('an applied AGENT commit declaring _autoChain executes ONE hop with the agent actor, seeds the exchange, emits the card, ignores the hop\'s own chain', async () => {
    const ids = await makeConversation()
    h.streamScript.push(
      { toolCalls: [{ id: 'llm_1', name: 'collect_customer_field', arguments: { field: 'email', value: 'x@y.ro' } }] },
      { content: 'Ți-am trimis codul pe email — introdu-l în card.' },
    )

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'emailul meu este x@y.ro', language: 'ro' }))

    // exactly TWO pipeline executions — the hop rides the AGENT actor, and
    // the hop's own _autoChain (generate_quote) is deliberately ignored
    expect(h.pipelineCalls).toEqual([
      { name: 'collect_customer_field', actor: 'agent' },
      { name: 'start_channel_verification', actor: 'agent' },
    ])

    // the chain exchange is seeded into the loop history before the next round
    expect(h.streamCalls.length).toBe(2)
    const msgs = h.streamCalls[1].options.messages
    const collectIdx = msgs.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'collect_customer_field')
    const chainIdx = msgs.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'start_channel_verification')
    expect(collectIdx).toBeGreaterThanOrEqual(0)
    expect(chainIdx).toBeGreaterThan(collectIdx)
    expect(msgs[chainIdx].toolCalls?.[0]?.id).toBe('llm_1_auto')
    expect(msgs[chainIdx + 1].role).toBe('tool')
    expect(String(msgs[chainIdx + 1].content)).toContain('Verification code sent')

    // the hop's card reached the stream in the same turn
    expect(events.some((e) => e.event === 'ui_action' && (e.data as { type?: string }).type === 'show_otp_entry')).toBe(true)
    expect(events.some((e) => e.event === 'content' && String(e.data.text).includes('codul pe email'))).toBe(true)
    expect(events.some((e) => e.event === 'done')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  }, 60000)

  it('NEGATIVE: a non-applied commit (requires_confirmation) never chains on the agent path', async () => {
    const ids = await makeConversation()
    h.collectOutcome = 'requires_confirmation'
    h.streamScript.push(
      { toolCalls: [{ id: 'llm_1', name: 'collect_customer_field', arguments: { field: 'email', value: 'x@y.ro' } }] },
      { content: 'Te rog confirmă pe card.' },
    )

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'emailul meu este x@y.ro', language: 'ro' }))

    expect(h.pipelineCalls).toEqual([{ name: 'collect_customer_field', actor: 'agent' }])
    expect(events.some((e) => e.event === 'ui_action' && (e.data as { type?: string }).type === 'show_otp_entry')).toBe(false)
    expect(events.some((e) => e.event === 'done')).toBe(true)
  }, 60000)
})
