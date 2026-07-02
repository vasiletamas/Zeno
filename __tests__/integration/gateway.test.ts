import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import type { ToolContext } from '@/lib/tools/types'

async function fixture() {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, productId: product.id } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  return { product, customer, conv, ctx }
}

// Makes sign_dnt legal with REAL rows (A2 erratum 7): answer every dnt-phase
// question for the product via the question-group engine.
async function answerAllDntQuestions(productId: string, conversationId: string): Promise<number> {
  const codes = await resolveGroupCodes(productId, 'dnt')
  const questions = await prisma.question.findMany({ where: { group: { code: { in: codes } } }, select: { id: true } })
  await prisma.answer.createMany({ data: questions.map((q) => ({ questionId: q.id, conversationId, value: 'da' })) })
  return questions.length
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

  it('requires_confirmation (ledgered) on first sign_dnt; a resubmit carrying ONLY {confirmToken} validates and applies', async () => {
    const { product, conv, customer, ctx } = await fixture()
    const total = await answerAllDntQuestions(product.id, conv.id)
    expect(total).toBeGreaterThan(0) // seeded dnt-phase questions must exist for this fixture
    const first = await executeCommit({ tool: 'sign_dnt', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(first.outcome).toBe('requires_confirmation')
    expect(first.confirmToken).toBeTruthy()
    // erratum 1: the confirmed call carries only the token — the gateway strips
    // confirm-class args before validation and injects the handler contract.
    const second = await executeCommit({ tool: 'sign_dnt', args: { confirmToken: first.confirmToken }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(second.outcome).toBe('applied')
    // erratum 6: the token issuance is a ledgered commit attempt.
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'sign_dnt' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.outcome)).toEqual(['requires_confirmation', 'applied'])
    expect(rows.at(-1)?.phaseFrom).toBeTruthy()
    const after = await prisma.conversation.findUnique({ where: { id: conv.id } })
    expect(after?.dntSignedAt).not.toBeNull()
  })

  it('sign_dnt with unanswered DNT questions is engine-blocked dnt_incomplete — still ledgered', async () => {
    const { conv, customer, ctx } = await fixture()
    const r = await executeCommit({ tool: 'sign_dnt', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r.outcome).toBe('rejected')
    expect(r.reason).toBe('dnt_incomplete')
    const row = await prisma.commitLedger.findFirst({ where: { conversationId: conv.id, tool: 'sign_dnt' } })
    expect(row?.reasonCode).toBe('dnt_incomplete')
  })
})
