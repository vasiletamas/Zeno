import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateSpy = vi.fn()
const findUniqueSpy = vi.fn()
const productFindUniqueSpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      update: (...args: unknown[]) => updateSpy(...args),
      findUnique: (...args: unknown[]) => findUniqueSpy(...args),
    },
    product: {
      findUnique: (...args: unknown[]) => productFindUniqueSpy(...args),
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
  beforeEach(() => { updateSpy.mockReset(); findUniqueSpy.mockReset(); productFindUniqueSpy.mockReset() })

  it('writes the candidate columns and returns a confirmation', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', name: { ro: 'Protect', en: 'Protect' } })
    findUniqueSpy.mockResolvedValueOnce({ candidateProductId: null, candidateConfidence: null })
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

  it('returns failure when product is not found', async () => {
    productFindUniqueSpy.mockResolvedValueOnce(null)

    const result = await setCandidateProduct(
      { productId: 'p-missing', confidence: 50 },
      CONTEXT,
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not found/i)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when called with the same productId and confidence already stored', async () => {
    productFindUniqueSpy.mockResolvedValueOnce({ id: 'p-protect', name: { ro: 'Protect', en: 'Protect' } })
    findUniqueSpy.mockResolvedValueOnce({ candidateProductId: 'p-protect', candidateConfidence: 80 })

    const result = await setCandidateProduct(
      { productId: 'p-protect', confidence: 80 },
      CONTEXT,
    )

    expect(result.success).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
