import { describe, it, expect, vi, beforeEach } from 'vitest'

const questionGroupFindManySpy = vi.fn()
const questionFindManySpy = vi.fn()
const answerFindManySpy = vi.fn()
const resolveProductRefSpy = vi.fn()
const listAvailableSpy = vi.fn()
const resolveCodesSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    questionGroup: { findMany: (...a: unknown[]) => questionGroupFindManySpy(...a) },
    question: { findMany: (...a: unknown[]) => questionFindManySpy(...a) },
    answer: { findMany: (...a: unknown[]) => answerFindManySpy(...a) },
    // B4: preview compares against the conversation's active application
    conversation: { findUnique: () => Promise.resolve({ activeApplicationId: 'app-1' }) },
    application: { findUnique: () => Promise.resolve({ id: 'app-1', status: 'OPEN' }) },
  },
}))
vi.mock('@/lib/tools/resolve-product', () => ({
  resolveProductRef: (...a: unknown[]) => resolveProductRefSpy(...a),
  listAvailableProductRefs: (...a: unknown[]) => listAvailableSpy(...a),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
}))

const { previewProductRequirements } = await import('@/lib/tools/handlers/preview-handlers')

const CONTEXT = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  db: (await import('@/lib/db')).prisma, // B4: loadActiveApplication reads through context.db
  language: 'ro' as const,
} as unknown as Parameters<typeof previewProductRequirements>[1]

describe('previewProductRequirements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAvailableSpy.mockResolvedValue([])
    resolveCodesSpy.mockImplementation((_pid: unknown, phase: string) =>
      phase === 'dnt' ? ['dnt_consent'] : ['application'],
    )
  })

  it('returns error when productId is missing', async () => {
    const r = await previewProductRequirements({}, CONTEXT)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/productId is required/i)
  })

  it('returns error with available products when the product is not found', async () => {
    resolveProductRefSpy.mockResolvedValueOnce(null)
    listAvailableSpy.mockResolvedValueOnce([{ id: 'p-life', code: 'protect' }])
    const r = await previewProductRequirements({ productId: 'nope' }, CONTEXT)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not found/i)
    expect(r.error).toMatch(/protect/)
  })

  it('splits answered (carry-over) vs unanswered (missing) and skips questions without a code', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    questionGroupFindManySpy.mockResolvedValueOnce([{ id: 'g-dnt' }, { id: 'g-app' }])
    questionFindManySpy.mockResolvedValueOnce([
      { id: 'q-age', code: 'AGE' },
      { id: 'q-health', code: 'HEALTH' },
      { id: 'q-occ', code: 'OCCUPATION' },
      { id: 'q-nocode', code: null },
    ])
    answerFindManySpy.mockResolvedValueOnce([{ questionId: 'q-age' }, { questionId: 'q-occ' }])
    const r = await previewProductRequirements({ productId: 'p-new' }, CONTEXT)
    expect(r.success).toBe(true)
    expect(r.data?.wouldCarryOver).toEqual(['AGE', 'OCCUPATION'])
    expect(r.data?.stillMissing).toEqual(['HEALTH'])
  })

  it('returns all missing when there are no prior answers', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    questionGroupFindManySpy.mockResolvedValueOnce([{ id: 'g-app' }])
    questionFindManySpy.mockResolvedValueOnce([{ id: 'q-1', code: 'B' }, { id: 'q-2', code: 'A' }])
    answerFindManySpy.mockResolvedValueOnce([])
    const r = await previewProductRequirements({ productId: 'p-new' }, CONTEXT)
    expect(r.success).toBe(true)
    expect(r.data?.wouldCarryOver).toEqual([])
    expect(r.data?.stillMissing).toEqual(['A', 'B'])
  })

  it('returns empty split when the product has no questions', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p-new', code: 'new_product', matchedBy: 'id' })
    questionGroupFindManySpy.mockResolvedValueOnce([{ id: 'g-app' }])
    questionFindManySpy.mockResolvedValueOnce([])
    const r = await previewProductRequirements({ productId: 'p-new' }, CONTEXT)
    expect(r.success).toBe(true)
    expect(r.data?.wouldCarryOver).toEqual([])
    expect(r.data?.stillMissing).toEqual([])
  })
})
