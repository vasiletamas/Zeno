import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct, proveChannel } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures'
import type { ToolContext } from '@/lib/tools/types'

async function fixture() {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
  // 2026-07-21 (R2): the DNT commits this suite drives require a proven
  // channel; without one the gateway refuses requires_identity before the
  // ordering behaviour under test is ever reached.
  await proveChannel(customer.id)
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  return { product, customer, conv, ctx }
}

// Makes sign_dnt legal with REAL rows (A2 erratum 7 / B2 session flow):
// open a session through the gateway, then answer every visible question.
async function openAndAnswerAll(customerId: string, conversationId: string, ctx: ToolContext): Promise<number> {
  const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', conversationId, customerId, toolContext: ctx })
  if (opened.outcome !== 'applied') throw new Error(`fixture open failed: ${opened.reason}`)
  return answerAllDntQuestions(customerId, conversationId)
}

describe.skipIf(!process.env.DATABASE_URL)('commit gateway — pinned #8 order', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('rejects a non-exposed commit with the engine reason and writes a ledger row', async () => {
    const { conv, customer, ctx } = await fixture()
    const r = await executeCommit({ tool: 'accept_quote', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r.outcome).toBe('rejected')
    const row = await prisma.commitLedger.findFirst({ where: { conversationId: conv.id, tool: 'accept_quote' } })
    expect(row?.outcome).toBe('rejected')
    expect(row?.actor).toBe('agent')
  })

  it('requires_confirmation (ledgered) on first sign_dnt; the confirmed resubmit carries the same material consent + token and applies', async () => {
    const { conv, customer, ctx } = await fixture()
    const total = await openAndAnswerAll(customer.id, conv.id, ctx)
    expect(total).toBeGreaterThan(0) // seeded dnt-phase questions must exist for this fixture
    const consent = { gdpr: true, aiDisclosure: true }
    const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(first.outcome).toBe('requires_confirmation')
    expect(first.confirmToken).toBeTruthy()
    // erratum 1 + B1.5: confirm-class args are stripped and the ceremony flag
    // injected server-side; the consent object is MATERIAL and rides along
    // unchanged, so the token (bound to the args hash) verifies.
    const second = await executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(second.outcome).toBe('applied')
    // erratum 6: the token issuance is a ledgered commit attempt.
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'sign_dnt' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.outcome)).toEqual(['requires_confirmation', 'applied'])
    expect(rows.at(-1)?.phaseFrom).toBeTruthy()
    const dnt = await prisma.dnt.findFirst({ where: { customerId: customer.id, status: 'ACTIVE' } })
    expect(dnt).not.toBeNull()
  })

  it('sign_dnt with an unanswered session is engine-blocked dnt_session_incomplete — still ledgered', async () => {
    const { conv, customer, ctx } = await fixture()
    const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(opened.outcome).toBe('applied')
    const r = await executeCommit({ tool: 'sign_dnt', args: { consent: { gdpr: true, aiDisclosure: true } }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r.outcome).toBe('rejected')
    expect(r.reason).toBe('dnt_session_incomplete')
    const row = await prisma.commitLedger.findFirst({ where: { conversationId: conv.id, tool: 'sign_dnt' } })
    expect(row?.reasonCode).toBe('dnt_session_incomplete')
  })
})
