/**
 * T13 (P3.1): a GUI action turn runs the STANDARD tool loop. Historical
 * instance (conv cmrm3fgku00056g0y4eb2hsme messageIndex 58): the synthetic
 * path executed sign_medical_declarations, whose result said "The quote can
 * be generated now.", then narrated over a TOOL-LESS gateway.stream call —
 * the model literally could not chain generate_quote and told the customer
 * the calculation was impossible. After the fix the synthetic execution
 * seeds the loop: the applied commit triggers the SAME post-commit refresh
 * the loop runs mid-loop (fresh tools + executor wall + [State update]
 * system message) BEFORE round 0, so the follow-up LLM round can call
 * generate_quote in the same turn.
 *
 * Seams mocked: gateway.stream (captures the tools/messages each round
 * receives), executeToolWithPipeline (applied envelopes, records the actor),
 * loadDomainSnapshot (pre-sign → post-sign fixture flip on execution).
 * Everything else — conversation resolution, message persistence, prompt
 * assembly, the loop itself — runs real against the test DB.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { Message, LLMToolDefinition } from '@/lib/llm/providers/types'

const h = vi.hoisted(() => ({
  phase: 'pre' as 'pre' | 'post',
  snapshots: { pre: null as unknown, post: null as unknown },
  streamCalls: [] as { agentSlug: string; options: { messages: Message[]; tools?: LLMToolDefinition[]; toolChoice?: string } }[],
  streamScript: [] as { content?: string; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] }[],
  pipelineCalls: [] as { name: string; actor: string | undefined }[],
}))

vi.mock('@/lib/llm/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/gateway')>()
  return {
    ...actual,
    gateway: {
      stream: vi.fn(async (agentSlug: string, options: never) => {
        h.streamCalls.push({ agentSlug, options })
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
  // deep-clone per call: the legality payload redaction must never leak
  // between the gate read and the post-commit refresh read
  loadDomainSnapshot: vi.fn(async () => JSON.parse(JSON.stringify(h.snapshots[h.phase]))),
}))

vi.mock('@/lib/tools/pipeline', () => ({
  executeToolWithPipeline: vi.fn(async (name: string, _args: Record<string, unknown>, ctx: { actor?: string }) => {
    h.pipelineCalls.push({ name, actor: ctx.actor })
    if (name === 'sign_medical_declarations') {
      h.phase = 'post' // the commit changed the world — the refresh must see it
      return {
        toolResult: {
          success: true,
          data: { _message: 'Medical declarations signed — 1 answers affirmed in one signature. The quote can be generated now.' },
          envelope: { outcome: 'applied', effects: [], ledgerId: 'led-sign' },
        },
      }
    }
    return {
      toolResult: {
        success: true,
        data: { quoteId: 'q-1', premiumAnnual: 190 },
        envelope: { outcome: 'applied', effects: [], ledgerId: `led-${name}` },
      },
    }
  }),
}))

import { prisma } from '@/lib/db'
import { handleChatTurn } from '@/lib/chat/orchestrator'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '@/__tests__/lib/engines/snapshot-fixtures'
import { VALID_DNT } from '@/__tests__/spec/helpers/spec-snapshots'
import { seedAgents } from '@/prisma/seeds/seed-agents'
import { resetFunnelTables } from '../helpers/test-db'
import type { DomainSnapshot } from '@/lib/engines/domain-types'

/** Complete application (coverage selected, questionnaire done), medical
 * declarations pending signature — the msg-58 turn-start world. */
const app = (signed: boolean): NonNullable<DomainSnapshot['application']> => ({
  id: 'app-1', status: 'OPEN', tier: 'standard', level: 'level_1', addon: false,
  answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false,
  medicalDeclarations: { requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed },
})
const snapshot = (signed: boolean): DomainSnapshot => makeSnapshot({
  consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
  dnt: VALID_DNT,
  // generate_quote's identity row: anyDeclaredOf [cnp, dateOfBirth] (B3.2)
  identity: { tier: 'anonymous', fields: { dateOfBirth: { provenance: 'declared' } }, verifiedChannels: [], pendingChallenge: null },
  application: app(signed),
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

describe('synthetic GUI turn runs the standard tool loop (T13)', () => {
  beforeAll(async () => { await seedAgents(prisma) })

  beforeEach(async () => {
    await resetFunnelTables()
    h.phase = 'pre'
    h.snapshots.pre = snapshot(false)
    h.snapshots.post = snapshot(true)
    h.streamCalls.length = 0
    h.streamScript.length = 0
    h.pipelineCalls.length = 0
  }, 60000)

  it('fixture precondition: pre-sign blocks generate_quote, post-sign exposes it', () => {
    const pre = deriveAndExpose(snapshot(false))
    expect(pre.actions.available).toContain('sign_medical_declarations')
    expect(pre.actions.available).not.toContain('generate_quote')
    const post = deriveAndExpose(snapshot(true))
    expect(post.actions.available).toContain('generate_quote')
  })

  it('an applied card click chains: post-commit tools + [State update] reach the next LLM round, which calls generate_quote', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })

    // LLM script: round 1 chains generate_quote, round 2 narrates the quote
    h.streamScript.push(
      { toolCalls: [{ id: 'llm_1', name: 'generate_quote', arguments: {} }] },
      { content: 'Oferta este gata: 190 lei/an.' },
    )

    const events = await drainEvents(handleChatTurn({
      conversationId: conv.id,
      customerId: customer.id,
      message: 'Semnare declarații medicale',
      language: 'ro',
      syntheticToolCall: { id: 'click_1', name: 'sign_medical_declarations', arguments: { confirmSignature: true } },
    }))

    // --- the narration call is no longer tool-less: round 1 got the POST-commit tools ---
    expect(h.streamCalls.length).toBe(2)
    const round1 = h.streamCalls[0].options
    expect(round1.tools, 'first LLM round after the synthetic commit must carry tools').toBeDefined()
    expect(round1.tools!.map((t) => t.function.name)).toContain('generate_quote')

    // --- the loop was seeded with the synthetic exchange, then the [State update] ---
    const msgs = round1.messages
    const assistantIdx = msgs.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'sign_medical_declarations')
    const toolIdx = msgs.findIndex((m) => m.role === 'tool' && m.toolCallId === 'click_1')
    // startsWith, not includes: the supersession CONSTRAINT in the system
    // prompt (messages[0]) itself mentions "[State update]"
    const refreshIdx = msgs.findIndex((m) => m.role === 'system' && m.content.startsWith('[State update]'))
    expect(assistantIdx).toBeGreaterThanOrEqual(0)
    expect(toolIdx).toBe(assistantIdx + 1)
    expect(refreshIdx).toBeGreaterThan(toolIdx)
    expect(msgs[refreshIdx].content).toMatch(/Available actions:.*generate_quote/)
    expect(msgs[toolIdx].content).toContain('The quote can be generated now')

    // --- the chained call executed through the pipeline with the AGENT actor ---
    expect(h.pipelineCalls).toEqual([
      { name: 'sign_medical_declarations', actor: 'gui' },
      { name: 'generate_quote', actor: 'agent' },
    ])

    // --- the turn still streams: card events + final narration + done ---
    expect(events.some((e) => e.event === 'content' && String(e.data.text).includes('Oferta este gata'))).toBe(true)
    expect(events.some((e) => e.event === 'done')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  }, 60000)

  it('_autoChain single hop (T8 §3.4): an applied synthetic commit declaring data._autoChain executes ONE follow-up gui tool, seeds BOTH exchanges before round 1, and ignores the hop\'s own _autoChain', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })

    const { executeToolWithPipeline } = await import('@/lib/tools/pipeline')
    const chainDecl = { tool: 'start_channel_verification', args: { channel: 'email' } }
    vi.mocked(executeToolWithPipeline)
      .mockImplementationOnce(async (name: string, _args, ctx) => {
        h.pipelineCalls.push({ name, actor: (ctx as { actor?: string }).actor })
        h.phase = 'post'
        return {
          toolResult: {
            success: true,
            data: { _message: 'Contact saved.', _autoChain: chainDecl },
            envelope: { outcome: 'applied', effects: [], ledgerId: 'led-syn', data: { _message: 'Contact saved.', _autoChain: chainDecl } },
          },
        } as never
      })
      .mockImplementationOnce(async (name: string, _args, ctx) => {
        h.pipelineCalls.push({ name, actor: (ctx as { actor?: string }).actor })
        return {
          toolResult: {
            success: true,
            // the hop declares its OWN _autoChain — the cap must ignore it
            data: { _message: 'Verification code sent.', _autoChain: { tool: 'generate_quote', args: {} } },
            envelope: { outcome: 'applied', effects: [], ledgerId: 'led-chain', data: { _message: 'Verification code sent.', _autoChain: { tool: 'generate_quote', args: {} } } },
            uiAction: { type: 'show_verification_prompt', payload: { channel: 'email' } },
          },
        } as never
      })

    h.streamScript.push({ content: 'Ți-am trimis codul pe email.' })

    const events = await drainEvents(handleChatTurn({
      conversationId: conv.id,
      customerId: customer.id,
      message: 'Salvează contactul',
      language: 'ro',
      syntheticToolCall: { id: 'click_3', name: 'collect_customer_field', arguments: { field: 'email', value: 'x@y.ro' } },
    }))

    // exactly TWO gui executions — the chained hop's own _autoChain is ignored
    expect(h.pipelineCalls).toEqual([
      { name: 'collect_customer_field', actor: 'gui' },
      { name: 'start_channel_verification', actor: 'gui' },
    ])

    // BOTH exchanges (assistant tool-call + tool result) are seeded before round 1
    const msgs = h.streamCalls[0].options.messages
    const synIdx = msgs.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'collect_customer_field')
    const chainIdx = msgs.findIndex((m) => m.role === 'assistant' && m.toolCalls?.[0]?.name === 'start_channel_verification')
    expect(synIdx).toBeGreaterThanOrEqual(0)
    expect(chainIdx).toBeGreaterThan(synIdx)
    expect(msgs[chainIdx + 1].role).toBe('tool')
    expect(msgs[chainIdx + 1].content).toContain('Verification code sent')

    // the hop's tool events + ui_action reached the stream
    expect(events.some((e) => e.event === 'ui_action' && (e.data as { type?: string }).type === 'show_verification_prompt')).toBe(true)
    expect(events.some((e) => e.event === 'content' && String(e.data.text).includes('codul pe email'))).toBe(true)
    expect(events.some((e) => e.event === 'done')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  }, 60000)

  it('a non-applied synthetic result seeds the loop WITHOUT a state refresh (no [State update] message)', async () => {
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })

    // make the synthetic tool return requires_confirmation instead of applied
    const { executeToolWithPipeline } = await import('@/lib/tools/pipeline')
    vi.mocked(executeToolWithPipeline).mockImplementationOnce(async (name: string, _args, ctx) => {
      h.pipelineCalls.push({ name, actor: (ctx as { actor?: string }).actor })
      return {
        toolResult: {
          success: false,
          data: { preview: { declarations: [] }, _instruction: 'A confirmation card is now shown to the customer in the chat UI.' },
          envelope: { outcome: 'requires_confirmation', effects: [], confirmToken: 'tok-1' },
        },
      } as never
    })

    h.streamScript.push({ content: 'Te rog confirmă pe card.' })

    const events = await drainEvents(handleChatTurn({
      conversationId: conv.id,
      customerId: customer.id,
      message: 'Semnare declarații medicale',
      language: 'ro',
      syntheticToolCall: { id: 'click_2', name: 'sign_medical_declarations', arguments: {} },
    }))

    expect(h.streamCalls.length).toBe(1)
    const msgs = h.streamCalls[0].options.messages
    expect(msgs.some((m) => m.role === 'system' && m.content.startsWith('[State update]'))).toBe(false)
    // the confirm card still reaches the GUI (byte-identical emission contract)
    const confirm = events.find((e) => e.event === 'ui_action' && (e.data as { type?: string }).type === 'confirm_required')
    expect(confirm).toBeDefined()
    expect((confirm!.data as { payload?: { confirmToken?: string } }).payload?.confirmToken).toBe('tok-1')
    expect(events.some((e) => e.event === 'done')).toBe(true)
  }, 60000)
})
