import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

it('creates the customer-scoped application from the candidate WITHOUT a DNT (T5.D1) and freezes product only (T5.D3)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('applied')
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  expect(app).toMatchObject({ productId: p.id, status: 'OPEN', tierId: null, levelId: null })
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).activeApplicationId).toBe(app.id)
  expect((r.data as { softOffer: string }).softOffer).toBe('channel_verification') // R6 soft offer, not a gate
})

it('a second set_application for the same product is rejected with application_already_open', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const r2 = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r2).toMatchObject({ outcome: 'rejected', reason: 'application_already_open' })
  // customer-scoped: a NEW conversation cannot open a second app for the product
  const conv2 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r3 = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv2.id, toolContext: ctx(c.id, conv2.id) })
  expect(r3).toMatchObject({ outcome: 'rejected', reason: 'application_already_open' })
})

// 2026-07-06 battery: the model passes the product CODE under productId; the
// raw value went straight into the Application FK insert, the FK violation
// poisoned the WHOLE gateway tx ('current transaction is aborted' on the
// ledger write) and the envelope was lost. The handler must resolve the ref.
it('set_application with the product CODE under productId resolves and applies (never a poisoned tx)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r = await executeCommit({ tool: 'set_application', args: { productId: p.code }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('applied')
  expect((await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })).productId).toBe(p.id)
})

it('NEGATIVE: set_application with a junk id → clean rejection with the available codes, ledger row intact', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r = await executeCommit({ tool: 'set_application', args: { productId: 'cmzzznotarealid0000000000' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('rejected')
  expect(String((r.data as { error?: string })?.error)).toMatch(/not found|Available codes/i)
  expect(await prisma.commitLedger.count({ where: { conversationId: conv.id, tool: 'set_application', outcome: 'rejected' } })).toBe(1)
})

it('no candidate product → rejected(no_candidate_product)', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r).toMatchObject({ outcome: 'rejected', reason: 'no_candidate_product' })
})
