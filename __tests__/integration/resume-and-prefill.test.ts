import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { getLastApplicationInfo } from '@/lib/tools/handlers/application-handlers'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

it('resume binds an OPEN application from a NEW conversation and returns the current position (T5.D4)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv1 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv1.id, toolContext: ctx(c.id, conv1.id) })
  const conv2 = await prisma.conversation.create({ data: { customerId: c.id } }) // days later, new channel
  const r = await executeCommit({ tool: 'resume_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv2.id, toolContext: ctx(c.id, conv2.id) })
  expect(r.outcome).toBe('applied')
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv2.id } })).activeApplicationId).not.toBeNull()
  expect((r.data as { position: { status: string } }).position.status).toBe('OPEN')
})

it('a PAUSED application unpauses on resume; a REFERRED one answers with_underwriter', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const paused = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'PAUSED' } })
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({ tool: 'resume_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(r.outcome).toBe('applied')
  expect((await prisma.application.findUniqueOrThrow({ where: { id: paused.id } })).status).toBe('OPEN')

  await prisma.application.update({ where: { id: paused.id }, data: { status: 'REFERRED' } })
  const conv2 = await prisma.conversation.create({ data: { customerId: c.id } })
  const r2 = await executeCommit({ tool: 'resume_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv2.id, toolContext: ctx(c.id, conv2.id) })
  expect(r2).toMatchObject({ outcome: 'rejected', reason: 'with_underwriter' })
})

it('get_last_application_info is a pure read over the latest COMPLETED app; proposals require per-question confirmation (T5.D5 — never silent copy)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const prior = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'COMPLETED', completedAt: new Date() } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'HEALTH_DECLARATION_CONFIRM' } })
  await prisma.answer.create({ data: { questionId: q.id, applicationId: prior.id, value: 'confirm' } })
  const convX = await prisma.conversation.create({ data: { customerId: c.id } })
  const info = await getLastApplicationInfo({}, ctx(c.id, convX.id))
  expect(info.data!.proposals).toContainEqual(expect.objectContaining({ questionCode: 'HEALTH_DECLARATION_CONFIRM', suggestedAnswer: 'confirm' }))
  // a NEW application starts with zero answers — the proposal is not an answer
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'set_application', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const fresh = await prisma.application.findFirstOrThrow({ where: { customerId: c.id, status: 'OPEN' } })
  expect(await prisma.answer.count({ where: { applicationId: fresh.id } })).toBe(0)
})
