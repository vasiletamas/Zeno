import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

it('first call returns requires_confirmation with a token; confirmed call cancels terminally (never COMPLETED)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const r1 = await executeCommit({ tool: 'cancel_application', args: { reason: 'changed_mind' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r1.outcome).toBe('requires_confirmation')
  expect(r1.confirmToken).toBeDefined()
  const r2 = await executeCommit({ tool: 'cancel_application', args: { reason: 'changed_mind' }, actor: 'agent', customerId: c.id, conversationId: conv.id, confirmToken: r1.confirmToken, toolContext: ctx(c.id, conv.id) })
  expect(r2.outcome).toBe('applied')
  expect(r2.effects).toContain('terminal')
  const app = await prisma.application.findFirstOrThrow({ where: { customerId: c.id } })
  expect(app.status).toBe('CANCELLED') // T5.D6: cancel is distinguishable from completion
  // the channel pointer is released — the conversation is back in DISCOVERY
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).activeApplicationId).toBeNull()
})

it('cancelling a COMPLETED application is rejected (no legal transition)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const app = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'COMPLETED' } })
  const conv = await prisma.conversation.create({ data: { customerId: c.id, activeApplicationId: app.id } })
  const r = await executeCommit({ tool: 'cancel_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r).toMatchObject({ outcome: 'rejected', reason: 'illegal_status_transition' })
})
