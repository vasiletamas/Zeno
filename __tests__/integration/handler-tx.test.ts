import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, ensureTestProduct } from '@/__tests__/helpers/test-db'
import { setCandidateProduct } from '@/lib/tools/handlers/candidate-handlers'
import type { ToolContext } from '@/lib/tools/types'

describe.skipIf(!process.env.DATABASE_URL)('handlers write through context.db', () => {
  beforeEach(async () => { await resetFunnelTables() })
  it('a handler running inside a rolled-back transaction leaves NO rows behind', async () => {
    const product = await ensureTestProduct()
    const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
    const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
    await expect(prisma.$transaction(async (tx) => {
      const ctx = { customerId: customer.id, conversationId: conv.id, language: 'ro', db: tx } as unknown as ToolContext
      const r = await setCandidateProduct({ productId: product.id, confidence: 80 }, ctx)
      expect(r.success).toBe(true)
      throw new Error('force rollback')
    })).rejects.toThrow('force rollback')
    const after = await prisma.conversation.findUnique({ where: { id: conv.id } })
    expect(after?.candidateProductId).toBeNull() // write rolled back with the tx → handler used ctx.db, not global prisma
  })
})
