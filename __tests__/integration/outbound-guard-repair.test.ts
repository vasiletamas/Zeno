/**
 * T16 (P3.2): outbound contradiction guard + one-shot self-repair, wired at
 * the ONLY clean pre-emission seam — the final narration round (zero tool
 * calls) buffers its content events until the draft clears
 * detectFalseUnavailabilityClaim against the freshest exposure set. A hit
 * discards the draft (the customer never sees the false "I can't"), records
 * a self_repair_triggered anomaly, appends a [Correction] system message and
 * re-invokes gateway.stream ONCE with tools enabled. Cap: 1 repair per turn
 * — a second offending draft streams as-is (the offline stale_gate_claim
 * ratchet still catches it).
 *
 * Seams mocked: gateway.stream (scripted rounds, per-call message snapshots),
 * executeToolWithPipeline (applied envelopes), loadDomainSnapshot (fixture).
 * Everything else — conversation resolution, prompt assembly, the loop, the
 * guard — runs real against the test DB (same harness as T13's
 * synthetic-turn-tool-loop.test.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { Message, LLMToolDefinition } from '@/lib/llm/providers/types'

const h = vi.hoisted(() => ({
  snapshot: null as unknown,
  streamCalls: [] as { agentSlug: string; options: { messages: Message[]; tools?: LLMToolDefinition[]; toolChoice?: string } }[],
  streamScript: [] as { content?: string; contentChunks?: string[]; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] }[],
  pipelineCalls: [] as { name: string; actor: string | undefined }[],
}))

vi.mock('@/lib/llm/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/gateway')>()
  return {
    ...actual,
    gateway: {
      stream: vi.fn(async (agentSlug: string, options: { messages: Message[]; tools?: LLMToolDefinition[]; toolChoice?: string }) => {
        // snapshot the messages array — the orchestrator mutates it in place
        // between rounds, so a live reference would alias later pushes
        h.streamCalls.push({ agentSlug, options: { ...options, messages: [...options.messages] } })
        const script = h.streamScript.shift()
        return (async function* () {
          // realistic provider order: text deltas first, tool_use blocks last
          for (const c of script?.contentChunks ?? (script?.content ? [script.content] : [])) {
            yield { type: 'content', content: c }
          }
          if (script?.toolCalls) yield { type: 'tool_calls', toolCalls: script.toolCalls }
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
import { eventBus, type Anomaly } from '@/lib/events'
import type { DomainSnapshot } from '@/lib/engines/domain-types'

/** Complete application, medical declarations signed/unsigned — same fixture
 * family as the T13 test: signed=true exposes generate_quote, false blocks it. */
const app = (signed: boolean): NonNullable<DomainSnapshot['application']> => ({
  id: 'app-1', status: 'OPEN', tier: 'standard', level: 'level_1', addon: false,
  answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false,
  medicalDeclarations: { requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed },
})
const snapshot = (signed: boolean): DomainSnapshot => makeSnapshot({
  consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
  dnt: VALID_DNT,
  identity: { tier: 'anonymous', fields: { dateOfBirth: { provenance: 'declared' } }, verifiedChannels: [], pendingChallenge: null },
  application: app(signed),
})

const FALSE_CLAIM = 'Din păcate, calcularea nu poate fi finalizată în această conversație.'

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

const contentTexts = (events: { event: string; data: Record<string, unknown> }[]): string[] =>
  events.filter((e) => e.event === 'content').map((e) => String(e.data.text))

async function makeConversation(): Promise<{ conversationId: string; customerId: string }> {
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })
  return { conversationId: conv.id, customerId: customer.id }
}

describe('outbound contradiction guard + one-shot self-repair (T16)', () => {
  let turnAnomalies: Anomaly[] = []
  let unsubscribe: (() => void) | null = null

  beforeAll(async () => { await seedAgents(prisma) })

  beforeEach(async () => {
    await resetFunnelTables()
    h.snapshot = snapshot(true)
    h.streamCalls.length = 0
    h.streamScript.length = 0
    h.pipelineCalls.length = 0
    turnAnomalies = []
    unsubscribe?.()
    unsubscribe = eventBus.on('turn:end', (e) => {
      if (e.type === 'turn:end') turnAnomalies.push(...e.anomalies)
    })
  }, 60000)

  it('fixture precondition: signed snapshot exposes generate_quote, unsigned blocks it', () => {
    expect(deriveAndExpose(snapshot(true)).actions.available).toContain('generate_quote')
    expect(deriveAndExpose(snapshot(false)).actions.available).not.toContain('generate_quote')
  })

  it('(a) clean final round: buffered content events flush byte-identical and in order', async () => {
    const ids = await makeConversation()
    h.streamScript.push(
      { content: 'Un moment.', toolCalls: [{ id: 'llm_1', name: 'generate_quote', arguments: {} }] },
      { contentChunks: ['Oferta', ' este gata: 190 lei/an', '.'] },
    )

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'vreau oferta', language: 'ro' }))

    // every content chunk arrives as its OWN event, original payloads, original order
    expect(contentTexts(events)).toEqual(['Un moment.', 'Oferta', ' este gata: 190 lei/an', '.'])
    expect(h.streamCalls.length).toBe(2)
    expect(turnAnomalies.some((a) => a.message === 'self_repair_triggered')).toBe(false)
    expect(events.some((e) => e.event === 'done')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  }, 60000)

  it('(b) false-claim draft: draft never streams, correction appended, ONE retry with tools, anomaly recorded', async () => {
    const ids = await makeConversation()
    h.streamScript.push(
      { content: FALSE_CLAIM },
      { content: 'Generez oferta chiar acum.' },
    )

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'vreau oferta', language: 'ro' }))

    // the offending draft was NOT flushed; the retry streamed
    const texts = contentTexts(events)
    expect(texts.join('')).not.toContain('nu poate fi finalizat')
    expect(texts.join('')).toContain('Generez oferta chiar acum.')

    // exactly one repair: a second stream call, with tools ENABLED
    expect(h.streamCalls.length).toBe(2)
    expect(h.streamCalls[1].options.tools, 'the corrective retry must carry tools').toBeDefined()
    expect(h.streamCalls[1].options.tools!.map((t) => t.function.name)).toContain('generate_quote')

    // the correction system message reached ONLY the retry call
    const corrections = (msgs: Message[]) => msgs.filter((m) => m.role === 'system' && m.content.startsWith('[Correction]'))
    expect(corrections(h.streamCalls[0].options.messages)).toHaveLength(0)
    const correction = corrections(h.streamCalls[1].options.messages)
    expect(correction).toHaveLength(1)
    expect(correction[0].content).toContain('generate_quote IS available right now')
    expect(correction[0].content).toContain('falsely claimed')

    // the anomaly persisted through the standard channel (turn:end / TurnTrace / TurnDebug)
    const anomaly = turnAnomalies.find((a) => a.message === 'self_repair_triggered')
    expect(anomaly).toBeDefined()
    expect(anomaly!.metadata.action).toBe('generate_quote')
    expect(String(anomaly!.metadata.claim)).toContain('nu poate fi finalizata')

    // the SAVED assistant message is the retry, not the discarded draft
    const saved = await prisma.message.findFirst({ where: { conversationId: ids.conversationId, role: 'assistant' }, orderBy: { createdAt: 'desc' } })
    expect(saved!.content).toBe('Generez oferta chiar acum.')
    expect(events.some((e) => e.event === 'done')).toBe(true)
  }, 60000)

  it('(c) truthful blocked-action refusal: no repair, single stream call, content flushes', async () => {
    h.snapshot = snapshot(false) // generate_quote genuinely blocked
    const ids = await makeConversation()
    h.streamScript.push({ content: 'Din păcate, calcularea nu poate fi finalizată încă.' })

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'vreau oferta', language: 'ro' }))

    expect(h.streamCalls.length).toBe(1)
    expect(contentTexts(events).join('')).toContain('nu poate fi finalizată încă')
    expect(turnAnomalies.some((a) => a.message === 'self_repair_triggered')).toBe(false)
    expect(events.some((e) => e.event === 'done')).toBe(true)
  }, 60000)

  it('(d) repair cap: an offending RETRY streams as-is — exactly 2 stream calls, one anomaly', async () => {
    const ids = await makeConversation()
    h.streamScript.push(
      { content: FALSE_CLAIM },
      { content: 'Îmi pare rău, oferta nu poate fi calculată aici.' }, // still offending
    )

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'vreau oferta', language: 'ro' }))

    expect(h.streamCalls.length).toBe(2) // never a third call
    const texts = contentTexts(events)
    expect(texts.join('')).not.toContain('nu poate fi finalizat') // first draft stayed discarded
    expect(texts.join('')).toContain('oferta nu poate fi calculată aici') // second one streams as-is
    expect(turnAnomalies.filter((a) => a.message === 'self_repair_triggered')).toHaveLength(1)
    expect(events.some((e) => e.event === 'done')).toBe(true)
  }, 60000)

  it('(e) the corrective retry may CALL the tool — the loop continues normally', async () => {
    const ids = await makeConversation()
    h.streamScript.push(
      { content: FALSE_CLAIM },
      { toolCalls: [{ id: 'llm_2', name: 'generate_quote', arguments: {} }] },
      { content: 'Oferta este gata: 190 lei/an.' },
    )

    const events = await drainEvents(handleChatTurn({ ...ids, message: 'vreau oferta', language: 'ro' }))

    expect(h.streamCalls.length).toBe(3)
    expect(h.pipelineCalls).toContainEqual({ name: 'generate_quote', actor: 'agent' })
    const texts = contentTexts(events)
    expect(texts.join('')).not.toContain('nu poate fi finalizat')
    expect(texts.join('')).toContain('Oferta este gata')
    expect(events.some((e) => e.event === 'done')).toBe(true)
    expect(events.some((e) => e.event === 'error')).toBe(false)
  }, 60000)
})
