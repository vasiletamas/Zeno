import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
beforeEach(async () => { await resetDb() })
it('enforces at most one ACTIVE session per customer (partial unique)', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  await expect(prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })).rejects.toThrow()
  // a second non-ACTIVE session is fine
  await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW', status: 'CANCELLED' } })
})
it('Dnt rows are customer-scoped with typed coverage; DntAnswer unique per (session, question)', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW', status: 'SIGNED' } })
  const d = await prisma.dnt.create({ data: { customerId: c.id, signedAt: new Date(), validUntil: new Date(Date.now() + 86400e3), productTypesCovered: ['LIFE'], sourceSessionId: s.id } })
  expect(d.productTypesCovered).toEqual(['LIFE'])
  expect(d.status).toBe('ACTIVE')
  const q = await prisma.question.findFirstOrThrow()
  await prisma.dntAnswer.create({ data: { sessionId: s.id, questionId: q.id, value: 'da' } })
  await expect(prisma.dntAnswer.create({ data: { sessionId: s.id, questionId: q.id, value: 'nu' } })).rejects.toThrow(/Unique constraint/)
})
