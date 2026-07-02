import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures'
import type { ToolContext } from '@/lib/tools/types'

async function fixture(productOnConversation = false) {
  const product = await ensureTestProduct()
  const customer = await prisma.customer.create({ data: { isAnonymous: false, language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id, ...(productOnConversation ? { productId: product.id } : {}) } })
  const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: prisma } as unknown as ToolContext
  return { product, customer, conv, ctx }
}

describe.skipIf(!process.env.DATABASE_URL)('gateway idempotency (#8 replay-first)', () => {
  beforeEach(async () => { await resetFunnelTables() })

  it('double-submit of the same commit applies once and replays the ORIGINAL outcome', async () => {
    const { product, conv, customer, ctx } = await fixture()
    const r1 = await executeCommit({ tool: 'set_candidate_product', args: { productId: product.id, confidence: 80 }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    const r2 = await executeCommit({ tool: 'set_candidate_product', args: { productId: product.id, confidence: 80 }, actor: 'gui', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r1.outcome).toBe('applied')
    expect(r2).toEqual(r1) // original envelope, verbatim
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'set_candidate_product' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.idempotencyDisposition)).toEqual(['fresh', 'replay'])
  })

  it('sign_dnt after success: later resubmits are engine-rejected against the post-sign state — never a second fresh apply', async () => {
    const { conv, customer, ctx } = await fixture(true)
    const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(opened.outcome).toBe('applied')
    await answerAllDntQuestions(customer.id, conv.id)
    const consent = { gdpr: true, aiDisclosure: true }
    const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(first.outcome).toBe('requires_confirmation')
    const applied = await executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(applied.outcome).toBe('applied')
    // LATER resubmits (any args) see the post-sign state: the session is
    // SIGNED, targetRef re-resolves to dnt_session:none, so the engine
    // rejects — a stale applied envelope is never replayed across a state
    // change. (A true concurrent double-submit still replays via the
    // in-lock argsHash re-check, pinned by the double-submit test above.)
    const resubmitSame = await executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(resubmitSame.outcome).toBe('rejected')
    const resubmit = await executeCommit({ tool: 'sign_dnt', args: { consent: { gdpr: true, aiDisclosure: false } }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(resubmit.outcome).toBe('rejected')
    const freshApplied = await prisma.commitLedger.count({ where: { conversationId: conv.id, tool: 'sign_dnt', outcome: 'applied', idempotencyDisposition: 'fresh' } })
    expect(freshApplied).toBe(1)
  })

  it('repeatable commit: collect_customer_field same field + same value → replay with the original envelope', async () => {
    const { conv, customer, ctx } = await fixture()
    const r1 = await executeCommit({ tool: 'collect_customer_field', args: { field: 'email', value: 'a@b.ro' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r1.outcome).toBe('applied')
    const r2 = await executeCommit({ tool: 'collect_customer_field', args: { field: 'email', value: 'a@b.ro' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r2).toEqual(r1)
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'collect_customer_field' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.idempotencyDisposition)).toEqual(['fresh', 'replay'])
    expect(rows.every((r) => r.targetRef === 'field:email')).toBe(true)
  })

  it('repeatable commit: collect_customer_field same field + DIFFERENT value is a fresh commit, not a conflict', async () => {
    const { conv, customer, ctx } = await fixture()
    const r1 = await executeCommit({ tool: 'collect_customer_field', args: { field: 'email', value: 'a@b.ro' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r1.outcome).toBe('applied')
    const r2 = await executeCommit({ tool: 'collect_customer_field', args: { field: 'email', value: 'else@b.ro' }, actor: 'agent', conversationId: conv.id, customerId: customer.id, toolContext: ctx })
    expect(r2.outcome).toBe('applied')
    const rows = await prisma.commitLedger.findMany({ where: { conversationId: conv.id, tool: 'collect_customer_field' }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.idempotencyDisposition)).toEqual(['fresh', 'fresh'])
    const after = await prisma.customer.findUnique({ where: { id: customer.id } })
    expect(after?.email).toBe('else@b.ro')
  })
})
