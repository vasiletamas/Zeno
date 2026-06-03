import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUnique = vi.fn()
const convUpdate = vi.fn()
const appFindUnique = vi.fn()
const appUpdate = vi.fn()
const quoteFindFirst = vi.fn()
const quoteUpdate = vi.fn()
const calculateProgressSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveProductRefSpy = vi.fn()
const listAvailableSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findUnique: (...args: unknown[]) => convFindUnique(...args),
      update: (...args: unknown[]) => convUpdate(...args),
    },
    application: {
      findUnique: (...args: unknown[]) => appFindUnique(...args),
      update: (...args: unknown[]) => appUpdate(...args),
    },
    quote: {
      findFirst: (...args: unknown[]) => quoteFindFirst(...args),
      update: (...args: unknown[]) => quoteUpdate(...args),
    },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  calculateProgress: (...args: unknown[]) => calculateProgressSpy(...args),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...args: unknown[]) => resolveCodesSpy(...args),
}))
vi.mock('@/lib/tools/resolve-product', () => ({
  resolveProductRef: (...args: unknown[]) => resolveProductRefSpy(...args),
  listAvailableProductRefs: (...args: unknown[]) => listAvailableSpy(...args),
}))

const { switchProduct } = await import('@/lib/tools/handlers/product-switch-handler')

const baseCtx = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof switchProduct>[1]

beforeEach(() => {
  vi.clearAllMocks()
  resolveProductRefSpy.mockResolvedValue(null)
  resolveCodesSpy.mockResolvedValue(['application', 'bd_medical'])
  calculateProgressSpy.mockResolvedValue({ total: 8, answered: 0, percentage: 0 })
  listAvailableSpy.mockResolvedValue([])
})

describe('switch_product handler', () => {
  it('fails when productId is missing or invalid', async () => {
    resolveProductRefSpy.mockResolvedValueOnce(null)
    const r = await switchProduct({ productId: 'invalid-id' }, baseCtx)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found|invalid/i)
  })

  it('sets Conversation.productId to the resolved product id', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce(null)
    quoteFindFirst.mockResolvedValueOnce(null)
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ productId: 'p-new' }),
    }))
  })

  it('nulls Application tier/level/addon when application exists for old product', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', tierId: 'tier-old', levelId: 'level-old',
      includesAddon: true, status: 'OPEN', productId: 'p-old', totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce(null)
    calculateProgressSpy.mockResolvedValueOnce({ total: 8, answered: 0, percentage: 0 })
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(appUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv-1' },
      data: expect.objectContaining({ tierId: null, levelId: null, includesAddon: false, totalQuestions: 8 }),
    }))
  })

  it('sets DRAFT quote status to EXPIRED', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', tierId: 'tier-old', levelId: 'level-old',
      includesAddon: true, status: 'OPEN', productId: 'p-old', totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce({ id: 'quote-1', applicationId: 'app-1', status: 'DRAFT', premiumAnnual: 500 })
    calculateProgressSpy.mockResolvedValueOnce({ total: 8, answered: 0, percentage: 0 })
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(quoteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'quote-1' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }))
  })

  it('does not update ACCEPTED quote (already in CLOSING phase)', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', tierId: 'tier-old', levelId: 'level-old',
      includesAddon: true, status: 'OPEN', productId: 'p-old', totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce({ id: 'quote-1', applicationId: 'app-1', status: 'ACCEPTED', premiumAnnual: 500 })
    calculateProgressSpy.mockResolvedValueOnce({ total: 8, answered: 0, percentage: 0 })
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(quoteUpdate).not.toHaveBeenCalled()
  })

  it('recomputes totalQuestions based on the new product groups', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', tierId: 'tier-old', levelId: 'level-old',
      includesAddon: true, status: 'OPEN', productId: 'p-old', totalQuestions: 10,
    })
    quoteFindFirst.mockResolvedValueOnce(null)
    calculateProgressSpy.mockResolvedValueOnce({ total: 15, answered: 0, percentage: 0 })
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(appUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conv-1' },
      data: expect.objectContaining({ totalQuestions: 15 }),
    }))
  })

  it('returns confirmation with category lifecycle', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce(null)
    quoteFindFirst.mockResolvedValueOnce(null)
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(r.confirmation).toBeDefined()
    expect(r.confirmation?.category).toBe('lifecycle')
    expect(r.confirmation?.label).toMatch(/product/i)
    expect(r.confirmation?.timestamp).toBeDefined()
  })

  it('handles case when no application exists (early discovery)', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    appFindUnique.mockResolvedValueOnce(null)
    quoteFindFirst.mockResolvedValueOnce(null)
    const r = await switchProduct({ productId: 'p-new' }, baseCtx)
    expect(r.success).toBe(true)
    expect(appUpdate).not.toHaveBeenCalled()
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ productId: 'p-new' }),
    }))
  })
})
