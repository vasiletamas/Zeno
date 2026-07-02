import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUnique = vi.fn()
const strategyFindUnique = vi.fn()
const productFindMany = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findUnique: (...args: unknown[]) => convFindUnique(...args) },
    objectionStrategy: { findUnique: (...args: unknown[]) => strategyFindUnique(...args) },
    product: { findMany: (...args: unknown[]) => productFindMany(...args) },
  },
}))

const { getObjectionStrategy } = await import('@/lib/tools/handlers/objection-handlers')

const STRATEGY = {
  title: 'Pretul de baza e prea mare',
  strategy: 'PRINCIPIU: ...',
  addonContext: null,
  isActive: true,
}

const CONTEXT = () => ({
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
}) as unknown as Parameters<typeof getObjectionStrategy>[1]

describe('getObjectionStrategy — fallback order', () => {
  beforeEach(() => { convFindUnique.mockReset(); strategyFindUnique.mockReset(); productFindMany.mockReset() })

  it('uses productId when set (existing behavior)', async () => {
    convFindUnique.mockResolvedValueOnce({ productId: 'p-protect', candidateProductId: null })
    strategyFindUnique.mockResolvedValueOnce(STRATEGY)

    const r = await getObjectionStrategy({ objectionType: 'price_base' }, CONTEXT())

    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ hasStrategy: true, title: STRATEGY.title })
    expect(strategyFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_type: { productId: 'p-protect', type: 'price_base' } },
    }))
  })

  it('falls back to candidateProductId when productId is null', async () => {
    convFindUnique.mockResolvedValueOnce({ productId: null, candidateProductId: 'p-protect' })
    strategyFindUnique.mockResolvedValueOnce(STRATEGY)

    const r = await getObjectionStrategy({ objectionType: 'price_base' }, CONTEXT())

    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ hasStrategy: true })
    expect(strategyFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_type: { productId: 'p-protect', type: 'price_base' } },
    }))
  })

  it('no product and no candidate → generic message (the pack-inferred fallback died in A5.2)', async () => {
    convFindUnique.mockResolvedValueOnce({ productId: null, candidateProductId: null })

    const r = await getObjectionStrategy({ objectionType: 'price_base' }, CONTEXT())

    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ hasStrategy: false })
    expect(productFindMany).not.toHaveBeenCalled()
  })

  it('returns generic message when no productId, no candidate, and no pack-inferred match', async () => {
    convFindUnique.mockResolvedValueOnce({ productId: null, candidateProductId: null })

    const r = await getObjectionStrategy({ objectionType: 'price_base' }, CONTEXT())

    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ hasStrategy: false })
    expect(r.message).toMatch(/no product selected/i)
  })
})
