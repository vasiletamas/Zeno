import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateSpy = vi.fn()
const conversationFindUniqueSpy = vi.fn()
const productFindUniqueSpy = vi.fn()
const productFindFirstSpy = vi.fn()
const productFindManySpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      update: (...args: unknown[]) => updateSpy(...args),
      findUnique: (...args: unknown[]) => conversationFindUniqueSpy(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => productFindUniqueSpy(...args),
      findFirst: (...args: unknown[]) => productFindFirstSpy(...args),
      findMany: (...args: unknown[]) => productFindManySpy(...args),
    },
  },
}))

const { setCandidateProduct } = await import('@/lib/tools/handlers/candidate-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof setCandidateProduct>[1]

describe('setCandidateProduct', () => {
  beforeEach(() => {
    updateSpy.mockReset()
    conversationFindUniqueSpy.mockReset()
    productFindUniqueSpy.mockReset()
    productFindFirstSpy.mockReset()
    productFindManySpy.mockReset()
  })

  it('writes the candidate columns and returns a confirmation', async () => {
    // resolver: id lookup hits
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', code: 'protect' })
    // handler: name lookup
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', name: { ro: 'Protect', en: 'Protect' } })
    conversationFindUniqueSpy.mockResolvedValueOnce({ candidateProductId: null, candidateConfidence: null })
    updateSpy.mockResolvedValueOnce({ id: 'conv-1' })

    const result = await setCandidateProduct(
      { productId: 'p-protect', confidence: 80 },
      CONTEXT,
    )

    expect(result.success).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        candidateProductId: 'p-protect',
        candidateConfidence: 80,
        candidateSetAt: expect.any(Date),
      }),
    })
    expect(result.confirmation).toMatchObject({
      category: 'lifecycle',
      label: 'Candidate product set',
    })
  })

  it('returns failure with available products list when product is not found', async () => {
    // resolver: id lookup misses; no code passed so no further resolver queries
    productFindUniqueSpy.mockResolvedValueOnce(null)
    // listAvailableProductRefs call
    productFindManySpy.mockResolvedValueOnce([
      { id: 'p-protect', code: 'protect', name: { ro: 'Protect' } },
    ])

    const result = await setCandidateProduct(
      { productId: 'p-missing', confidence: 50 },
      CONTEXT,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
    expect(result.error).toMatch(/protect/)
    expect(result.data).toMatchObject({
      availableProducts: [expect.objectContaining({ code: 'protect' })],
    })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when called with the same productId and confidence already stored', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', code: 'protect' })
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', name: { ro: 'Protect', en: 'Protect' } })
    conversationFindUniqueSpy.mockResolvedValueOnce({ candidateProductId: 'p-protect', candidateConfidence: 80 })

    const result = await setCandidateProduct(
      { productId: 'p-protect', confidence: 80 },
      CONTEXT,
    )

    expect(result.success).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('tolerates leading/trailing whitespace in productId', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', code: 'protect' })
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', name: { ro: 'Protect', en: 'Protect' } })
    conversationFindUniqueSpy.mockResolvedValueOnce({ candidateProductId: null, candidateConfidence: null })
    updateSpy.mockResolvedValueOnce({ id: 'conv-1' })

    const result = await setCandidateProduct(
      { productId: '  p-protect  ', confidence: 80 },
      CONTEXT,
    )

    expect(result.success).toBe(true)
    // resolver should have queried for the trimmed id
    expect(productFindUniqueSpy).toHaveBeenCalledWith({
      where: { id: 'p-protect' },
      select: { id: true, code: true },
    })
  })
})
