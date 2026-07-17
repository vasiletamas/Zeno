/**
 * T19 (P3.4): contact submission IS the consent — the code auto-sends and
 * the entry card rides the commit. Evidence (conv cmrm3fgku00056g0y4eb2hsme
 * messageIndex 66-74): the customer submitted their email in a field labeled
 * "for identity verification"; the model then ASKED "trimit codul...?" in
 * prose — three round-trips for one code send.
 *
 * collect_customer_field(email) now declares a GUARDED data._autoChain to
 * start_channel_verification (guard mirrors the exposure rule: no verified
 * email channel, no pending challenge — so the happy path never logs a
 * rejected hop) plus a directive _message. The orchestrator executes the hop
 * (T8 contract), so the challenge row + show_otp_entry card land in the SAME
 * turn as the collect.
 *
 * Ring 1 (gateway-level): the DECLARATION and its guards — real executeCommit
 * against the test DB, nothing mocked.
 * Ring 2 (full turn): a GUI submit_field turn through handleChatTurn with the
 * REAL pipeline (only the LLM stream is scripted) — collect applied AND
 * challenge created AND show_otp_entry emitted in one turn.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { randomUUID } from 'crypto'
import type { Message, LLMToolDefinition } from '@/lib/llm/providers/types'

const h = vi.hoisted(() => ({
  streamCalls: [] as { agentSlug: string; options: { messages: Message[]; tools?: LLMToolDefinition[] } }[],
  streamScript: [] as { content?: string; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] }[],
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

import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { lastMockEmailTo } from '@/lib/email/providers/mock'
import { seedAgents } from '@/prisma/seeds/seed-agents'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import type { ToolContext } from '@/lib/tools/types'

// actor 'gui' rides the ToolContext (the executor/handlers read it there):
// the card submit IS first-party input, so the P0-1 grounding guard stands down
const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

async function makeConversation() {
  const customer = await createCustomer({ isAnonymous: true })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })
  return { customerId: customer.id, conversationId: conv.id }
}

const collectEmail = (ids: { customerId: string; conversationId: string }, value: string) =>
  executeCommit({
    tool: 'collect_customer_field', actor: 'gui', customerId: ids.customerId, conversationId: ids.conversationId,
    args: { field: 'email', value }, toolContext: ctx(ids.customerId, ids.conversationId),
  })

type ChainDecl = { tool: string; args: Record<string, unknown> } | undefined
const chainOf = (data: unknown): ChainDecl => (data as { _autoChain?: ChainDecl })?._autoChain
const messageOf = (data: unknown): string => String((data as { _message?: string })?._message ?? '')

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

describe('collect_customer_field(email) — guarded _autoChain declaration (T19)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('declares the chain + the directive _message on a clean customer, WITHOUT sending anything itself', async () => {
    const ids = await makeConversation()
    const r = await collectEmail(ids, 'ion.chain@example.ro')
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toEqual({
      tool: 'start_channel_verification',
      args: { channel: 'email', target: 'ion.chain@example.ro' },
    })
    expect(messageOf(r.data)).toBe(
      'Contact saved. The verification code was ALREADY sent automatically to i***@example.ro — a code-entry card is shown. Do NOT ask whether to send the code and do NOT resend.',
    )
    // the handler DECLARES; only the orchestrator executes — no challenge row yet
    expect(await prisma.verificationChallenge.count({ where: { customerId: ids.customerId } })).toBe(0)
  })

  it('NEGATIVE: an already-verified email channel suppresses the chain (nothing to verify again)', async () => {
    const ids = await makeConversation()
    // consumed challenge = verified evidence (verifiedChannelsFor reads consumption)
    await prisma.verificationChallenge.create({
      data: {
        customerId: ids.customerId, channel: 'email', target: 'old@example.ro',
        codeHash: 'h', linkToken: randomUUID(), conversationId: ids.conversationId,
        expiresAt: new Date(Date.now() + 600_000), attemptsRemaining: 5, consumedAt: new Date(),
      },
    })
    const r = await collectEmail(ids, 'ion.chain@example.ro')
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toBeUndefined()
    expect(messageOf(r.data)).not.toContain('ALREADY sent')
  })

  it('NEGATIVE: a pending challenge suppresses the chain (the hop would be verification_already_pending)', async () => {
    const ids = await makeConversation()
    await prisma.verificationChallenge.create({
      data: {
        customerId: ids.customerId, channel: 'email', target: 'ion.chain@example.ro',
        codeHash: 'h', linkToken: randomUUID(), conversationId: ids.conversationId,
        expiresAt: new Date(Date.now() + 600_000), attemptsRemaining: 5,
      },
    })
    const r = await collectEmail(ids, 'ion.chain@example.ro')
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toBeUndefined()
  })

  it('NEGATIVE: a phone submission never chains while SMS is undeliverable (T20 owns phone)', async () => {
    const ids = await makeConversation()
    const r = await executeCommit({
      tool: 'collect_customer_field', actor: 'gui', customerId: ids.customerId, conversationId: ids.conversationId,
      args: { field: 'phone', value: '0722334455' }, toolContext: ctx(ids.customerId, ids.conversationId),
    })
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toBeUndefined()
    expect(messageOf(r.data)).not.toContain('ALREADY sent')
  })
})

describe('GUI submit_field(email) turn — the code auto-sends and the card rides the commit (T19)', () => {
  beforeAll(async () => { await seedAgents(prisma) })

  beforeEach(async () => {
    await resetFunnelTables()
    h.streamCalls.length = 0
    h.streamScript.length = 0
  }, 60000)

  it('one turn: collect applied (gui) + challenge row created + show_otp_entry emitted + email actually sent', async () => {
    const ids = await makeConversation()
    h.streamScript.push({ content: 'Ți-am trimis codul de verificare pe email — introdu-l în cardul afișat.' })

    const events = await drainEvents(handleChatTurn({
      conversationId: ids.conversationId,
      customerId: ids.customerId,
      message: '[Action: submit_field email]',
      language: 'ro',
      syntheticToolCall: { id: 'click_email', name: 'collect_customer_field', arguments: { field: 'email', value: 'ion.sim@example.ro' } },
    }))

    // both commits ledgered applied in the SAME turn, both with the gui actor
    // (the hop is a deterministic consequence of the click — A2.9)
    const collectRow = await prisma.commitLedger.findFirst({ where: { conversationId: ids.conversationId, tool: 'collect_customer_field', outcome: 'applied' } })
    expect(collectRow?.actor).toBe('gui')
    const sendRow = await prisma.commitLedger.findFirst({ where: { conversationId: ids.conversationId, tool: 'start_channel_verification', outcome: 'applied' } })
    expect(sendRow?.actor).toBe('gui')

    // the challenge row exists and the mock provider actually sent the code
    const challenge = await prisma.verificationChallenge.findFirst({ where: { customerId: ids.customerId, consumedAt: null } })
    expect(challenge).toMatchObject({ channel: 'email', target: 'ion.sim@example.ro' })
    expect(lastMockEmailTo('ion.sim@example.ro')?.code).toMatch(/^\d{6}$/)

    // the OTP entry card rode the same turn
    const otp = events.find((e) => e.event === 'ui_action' && (e.data as { type?: string }).type === 'show_otp_entry')
    expect(otp).toBeDefined()
    expect((otp!.data as { payload?: { channel?: string } }).payload?.channel).toBe('email')

    // the model's narration round saw the directive result AND the chain exchange
    const msgs = h.streamCalls[0].options.messages
    const collectToolIdx = msgs.findIndex((m) => m.role === 'tool' && String(m.content).includes('ALREADY sent automatically'))
    const chainIdx = msgs.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'start_channel_verification')
    expect(collectToolIdx).toBeGreaterThanOrEqual(0)
    expect(chainIdx).toBeGreaterThan(collectToolIdx)

    expect(events.some((e) => e.event === 'done')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  }, 60000)
})
