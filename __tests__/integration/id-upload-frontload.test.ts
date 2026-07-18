/**
 * T27 (P5.3): the ID demand used to AMBUSH the customer at the payment gate
 * (ensure_payment_session → requires_identity: document:id_card). The upload
 * card now rides the OTP-confirm commit via a guarded data._autoChain
 * (T19/T8 single-hop contract): channel verified → request_document_upload
 * in the SAME turn → extraction completes the profile (name/DOB/CNP) with
 * document-grade provenance → the payment moment stays frictionless — and
 * T28's age-band reconciliation runs the moment the document lands.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { Message, LLMToolDefinition } from '@/lib/llm/providers/types'

const h = vi.hoisted(() => ({
  streamScript: [] as { content?: string; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] }[],
}))

vi.mock('@/lib/llm/gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/gateway')>()
  return {
    ...actual,
    gateway: {
      stream: vi.fn(async (_agentSlug: string, _options: { messages: Message[]; tools?: LLMToolDefinition[] }) => {
        const script = h.streamScript.shift()
        return (async function* () {
          if (script?.toolCalls) yield { type: 'tool_calls', toolCalls: script.toolCalls }
          if (script?.content) yield { type: 'content', content: script.content }
          yield { type: 'done', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
        })()
      }),
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
import { processDocument } from '@/lib/identity/document-pipeline'
import { setMockExtraction } from '@/lib/identity/extraction-provider'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { resetDb, createCustomer } from '../helpers/test-db'
import { buildAcceptReadyQuote, fixtureCtx } from '../helpers/funnel-fixtures'
import type { ToolContext } from '@/lib/tools/types'

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

type ChainDecl = { tool: string; args: Record<string, unknown> } | undefined
const chainOf = (data: unknown): ChainDecl => (data as { _autoChain?: ChainDecl })?._autoChain
const messageOf = (data: unknown): string => String((data as { _message?: string })?._message ?? '')

async function makeConversationOnProtect() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const customer = await createCustomer({ isAnonymous: true })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id, language: 'ro', channel: 'web' } })
  return { customerId: customer.id, conversationId: conv.id }
}

async function startVerification(customerId: string, conversationId: string, email: string): Promise<string> {
  const started = await executeCommit({
    tool: 'start_channel_verification', actor: 'agent', customerId, conversationId,
    args: { channel: 'email', target: email }, toolContext: ctx(customerId, conversationId),
  })
  if (started.outcome !== 'applied') throw new Error(`start_channel_verification ${started.outcome} (${started.reason})`)
  const code = lastMockEmailTo(email)?.code
  if (!code) throw new Error('no code in the mock mailbox')
  return code
}

const confirm = (customerId: string, conversationId: string, code: string) =>
  executeCommit({
    tool: 'confirm_channel_verification', actor: 'gui', customerId, conversationId,
    args: { code }, toolContext: ctx(customerId, conversationId),
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

describe('confirm_channel_verification — guarded _autoChain to request_document_upload (T27)', () => {
  beforeEach(async () => { await resetDb() })

  it('declares the chain + the directive _message when the product requires id_card and none is validated', async () => {
    const ids = await makeConversationOnProtect()
    const code = await startVerification(ids.customerId, ids.conversationId, 'front@example.ro')
    const r = await confirm(ids.customerId, ids.conversationId, code)
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toEqual({ tool: 'request_document_upload', args: { kind: 'id_card' } })
    expect(messageOf(r.data)).toContain('ID-upload card is already shown')
    expect(messageOf(r.data)).toContain('do NOT ask for those by mouth')
  })

  it('NEGATIVE: a validated id_card suppresses the chain', async () => {
    const ids = await makeConversationOnProtect()
    await prisma.customerDocument.create({
      data: { customerId: ids.customerId, kind: 'id_card', status: 'validated', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' },
    })
    const code = await startVerification(ids.customerId, ids.conversationId, 'front2@example.ro')
    const r = await confirm(ids.customerId, ids.conversationId, code)
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toBeUndefined()
  })

  it('NEGATIVE: no product in focus → no chain (nothing demands a document)', async () => {
    const customer = await createCustomer({ isAnonymous: true })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id, language: 'ro', channel: 'web' } })
    const code = await startVerification(customer.id, conv.id, 'front3@example.ro')
    const r = await confirm(customer.id, conv.id, code)
    expect(r.outcome).toBe('applied')
    expect(chainOf(r.data)).toBeUndefined()
  })
})

describe('full turn: OTP confirm → upload card in the SAME turn → extraction completes the profile (T27)', () => {
  beforeAll(async () => { await seedAgents(prisma) })
  beforeEach(async () => {
    await resetDb()
    h.streamScript.length = 0
  }, 60000)

  it('the gui OTP-confirm turn emits show_document_upload; extraction then verifies name/cnp/dateOfBirth', async () => {
    const ids = await makeConversationOnProtect()
    const code = await startVerification(ids.customerId, ids.conversationId, 'turn@example.ro')
    h.streamScript.push({ content: 'Email verificat — încarcă buletinul în cardul afișat.' })

    const events = await drainEvents(handleChatTurn({
      conversationId: ids.conversationId,
      customerId: ids.customerId,
      message: '[Action: submit_otp]',
      language: 'ro',
      syntheticToolCall: { id: 'click_otp', name: 'confirm_channel_verification', arguments: { code } },
    }))

    // the chained request_document_upload landed in the SAME turn
    const chainRow = await prisma.commitLedger.findFirst({ where: { conversationId: ids.conversationId, tool: 'request_document_upload', outcome: 'applied' } })
    expect(chainRow).not.toBeNull()
    const upload = events.find((e) => e.event === 'ui_action' && (e.data as { type?: string }).type === 'show_document_upload')
    expect(upload).toBeDefined()
    expect((upload!.data as { payload?: { kind?: string } }).payload?.kind).toBe('id_card')

    // the upload → extraction leg: document-grade provenance for name/cnp/DOB
    setMockExtraction({ name: 'Ion Turn', cnp: '1900101080012', dateOfBirth: '1990-01-01', expiryDate: '2031-01-01' })
    const doc = await prisma.customerDocument.create({
      data: { customerId: ids.customerId, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' },
    })
    const processed = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(processed.status).toBe('validated')
    for (const field of ['name', 'cnp', 'dateOfBirth']) {
      const row = await prisma.customerProfileField.findUniqueOrThrow({ where: { customerId_field: { customerId: ids.customerId, field } } })
      expect(row.provenance).toBe('verified')
    }
  }, 60000)
})

describe('the payment moment stays frictionless (T27 + T28 pair)', () => {
  beforeEach(async () => { await resetDb() }, 60000)

  it('with the doc validated up-front, ensure_payment_session is exposed after acceptance — no document ambush', async () => {
    const fx = await buildAcceptReadyQuote()
    // accept through the real gateway (agent two-step)
    const accept = (args: Record<string, unknown>) =>
      executeCommit({ tool: 'accept_quote', args, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })
    const ask = await accept({ paymentOption: 'annual' })
    if (ask.outcome !== 'requires_confirmation') throw new Error(`accept ask ${ask.outcome}`)
    const res = await accept({ paymentOption: 'annual', confirmToken: ask.confirmToken })
    if (res.outcome !== 'applied') throw new Error(`accept ${res.outcome}`)

    // WITHOUT the document: the gate blocks with the ambush T27 kills
    const before = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(before.actions.available).not.toContain('ensure_payment_session')
    expect(before.actions.blocked).toContainEqual(expect.objectContaining({
      action: 'ensure_payment_session', reason: 'requires_identity', params: { needs: ['document:id_card'] },
    }))

    // the front-loaded upload validates (extraction matches the declared facts)
    setMockExtraction({ name: 'Ion Fixture', cnp: '1900101080012', dateOfBirth: '1990-01-01', expiryDate: '2031-01-01' })
    const doc = await prisma.customerDocument.create({
      data: { customerId: fx.customerId, kind: 'id_card', encryptedData: Buffer.from('img'), dataIv: 'iv', dataTag: 'tag' },
    })
    const processed = await processDocument(doc.id, { onFieldVerified: () => {} })
    expect(processed.status).toBe('validated')

    const after = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
    expect(after.actions.available).toContain('ensure_payment_session')
  }, 60000)
})
