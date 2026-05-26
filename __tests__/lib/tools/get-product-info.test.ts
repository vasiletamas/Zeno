import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueSpy = vi.fn()
const findFirstSpy = vi.fn()
const findManySpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    product: {
      findUnique: (...args: unknown[]) => findUniqueSpy(...args),
      findFirst: (...args: unknown[]) => findFirstSpy(...args),
      findMany: (...args: unknown[]) => findManySpy(...args),
    },
  },
}))

const { getToolHandler } = await import('@/lib/tools/registry')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<NonNullable<ReturnType<typeof getToolHandler>>>[1]

const FULL_PRODUCT = {
  id: 'p1',
  code: 'protect',
  name: { ro: 'Protect', en: 'Protect' },
  pricingTiers: [],
  addons: [],
}

describe('get_product_info handler', () => {
  beforeEach(() => {
    findUniqueSpy.mockReset()
    findFirstSpy.mockReset()
    findManySpy.mockReset()
  })

  it('resolves productCode with mismatched case ("Protect" → "protect")', async () => {
    findUniqueSpy
      .mockResolvedValueOnce(null) // resolver: exact code lookup misses
      .mockResolvedValueOnce(FULL_PRODUCT) // handler: load by canonical id
    findFirstSpy.mockResolvedValueOnce({ id: 'p1', code: 'protect' }) // resolver: case-insensitive hit

    const handler = getToolHandler('get_product_info')
    if (!handler) throw new Error('handler not registered')
    const result = await handler({ productCode: 'Protect' }, CONTEXT)

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ product: expect.objectContaining({ code: 'protect' }) })
  })

  it('resolves productCode with leading/trailing whitespace', async () => {
    findUniqueSpy
      .mockResolvedValueOnce({ id: 'p1', code: 'protect' }) // resolver: exact match after trim
      .mockResolvedValueOnce(FULL_PRODUCT) // handler: load by canonical id

    const handler = getToolHandler('get_product_info')!
    const result = await handler({ productCode: '  protect  ' }, CONTEXT)

    expect(result.success).toBe(true)
  })

  it('returns a helpful error with available products when nothing matches', async () => {
    findUniqueSpy.mockResolvedValueOnce(null)
    findFirstSpy.mockResolvedValueOnce(null)
    findManySpy
      .mockResolvedValueOnce([]) // resolver: name fallback empty
      .mockResolvedValueOnce([{ id: 'p1', code: 'protect', name: { ro: 'Protect' } }]) // helpful list

    const handler = getToolHandler('get_product_info')!
    const result = await handler({ productCode: 'NonExistent' }, CONTEXT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/NonExistent/)
    expect(result.data).toMatchObject({
      availableProducts: [expect.objectContaining({ code: 'protect' })],
    })
  })

  it('still works via productId path', async () => {
    findUniqueSpy
      .mockResolvedValueOnce({ id: 'p1', code: 'protect' }) // resolver: id match
      .mockResolvedValueOnce(FULL_PRODUCT) // handler: load by id

    const handler = getToolHandler('get_product_info')!
    const result = await handler({ productId: 'p1' }, CONTEXT)

    expect(result.success).toBe(true)
  })

  it('returns failure when neither id nor code is provided', async () => {
    const handler = getToolHandler('get_product_info')!
    const result = await handler({}, CONTEXT)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/required/i)
  })
})
