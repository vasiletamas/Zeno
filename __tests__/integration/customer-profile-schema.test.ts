import { describe, it, expect, beforeAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'

describe('CustomerProfileField schema', () => {
  beforeAll(async () => { await resetDb() })
  it('enforces one row per (customerId, field)', async () => {
    const c = await createCustomer()
    await prisma.customerProfileField.create({ data: { customerId: c.id, field: 'email', value: 'a@b.ro', provenance: 'declared', source: 't' } })
    await expect(prisma.customerProfileField.create({ data: { customerId: c.id, field: 'email', value: 'x@y.ro', provenance: 'declared', source: 't' } })).rejects.toThrow(/Unique constraint/)
  })
  it('Customer has tombstone columns and no extractedProfile', async () => {
    const dup = await createCustomer(); const canon = await createCustomer()
    const u = await prisma.customer.update({ where: { id: dup.id }, data: { mergedIntoId: canon.id, mergedAt: new Date() } })
    expect(u.mergedIntoId).toBe(canon.id)
    expect('extractedProfile' in u).toBe(false)
  })
})
