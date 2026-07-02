import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, DOMAIN_TABLES } from '@/__tests__/helpers/test-db'

describe('test-db harness', () => {
  it('resetDb truncates domain tables and reseeds', async () => {
    expect(process.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL) // single-client rule: no split brain
    const c = await prisma.customer.create({ data: { isAnonymous: true } })
    await resetDb()
    expect(await prisma.customer.findUnique({ where: { id: c.id } })).toBeNull()
    expect(await prisma.product.count()).toBeGreaterThan(0) // reseed ran (protect exists)
  })
  it('DOMAIN_TABLES is the single truncate list other packages extend', () => {
    expect(DOMAIN_TABLES).toContain('Answer')
    expect(new Set(DOMAIN_TABLES).size).toBe(DOMAIN_TABLES.length)
  })
})
