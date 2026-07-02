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

it('no candidate product → rejected(no_candidate_product)', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r).toMatchObject({ outcome: 'rejected', reason: 'no_candidate_product' })
})
