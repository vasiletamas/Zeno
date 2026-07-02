import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'

beforeEach(async () => { await resetDb() })

it('at most one open application per (customer, product); CANCELLED frees the slot', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'OPEN' } })
  await expect(prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'OPEN' } })).rejects.toThrow()
  await prisma.application.updateMany({ where: { customerId: c.id }, data: { status: 'CANCELLED' } })
  await expect(prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'OPEN' } })).resolves.toBeDefined()
})

it('answers key on the application; REFERRED exists; conversation carries the pointer', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const app = await prisma.application.create({ data: { customerId: c.id, productId: p.id, status: 'REFERRED' } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'HEALTH_DECLARATION_CONFIRM' } })
  await prisma.answer.create({ data: { questionId: q.id, applicationId: app.id, value: 'confirm' } })
  await expect(prisma.answer.create({ data: { questionId: q.id, applicationId: app.id, value: 'x' } })).rejects.toThrow(/Unique constraint/)
  const conv = await prisma.conversation.create({ data: { customerId: c.id, activeApplicationId: app.id } })
  expect(conv.activeApplicationId).toBe(app.id)
})
