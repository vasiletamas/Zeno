import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaMock = {
  conversation: { findUnique: vi.fn(), update: vi.fn() },
  customer: { findUnique: vi.fn() },
  application: { findUnique: vi.fn(), update: vi.fn() },
  answer: { findMany: vi.fn(), upsert: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  question: { findMany: vi.fn() },
  quote: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  pricingTier: { findUnique: vi.fn(), findFirst: vi.fn() },
  pricingLevel: { findUnique: vi.fn(), findFirst: vi.fn() },
  product: { findUnique: vi.fn() },
}

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: vi.fn(),
  resolveActiveProductId: vi.fn(),
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({ calculateProgress: vi.fn() }))
vi.mock('@/lib/tools/resolve-product', () => ({ resolveProductRef: vi.fn(), listAvailableProductRefs: vi.fn() }))

const { changeSelection } = await import('@/lib/tools/handlers/change-selection-handlers')
const { switchProduct } = await import('@/lib/tools/handlers/product-switch-handler')
const { resolveProductRef } = await import('@/lib/tools/resolve-product')
const { resolveGroupCodes } = await import('@/lib/engines/question-groups')
const { calculateProgress } = await import('@/lib/engines/questionnaire-engine')

const CTX = { conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const } as unknown as Parameters<typeof changeSelection>[1]

describe('navigation integration', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('change_selection expires the DRAFT quote when the tier changes', async () => {
    prismaMock.application.findUnique.mockResolvedValueOnce({ id: 'app-1', productId: 'p-1', tierId: 'tier-std', levelId: 'lvl-1', includesAddon: false })
    prismaMock.pricingTier.findFirst.mockResolvedValueOnce({ id: 'tier-optim', code: 'optim' })
    prismaMock.quote.findUnique.mockResolvedValueOnce({ id: 'q-1', status: 'DRAFT' })
    prismaMock.quote.update.mockResolvedValueOnce({ id: 'q-1', status: 'EXPIRED' })
    prismaMock.question.findMany.mockResolvedValueOnce([{ id: 'q-pkg', code: 'PACKAGE_CHOICE' }])
    prismaMock.answer.upsert.mockResolvedValueOnce({})
    prismaMock.application.update.mockResolvedValueOnce({})

    const r = await changeSelection({ tier: 'optim' }, CTX)

    expect(r.success).toBe(true)
    expect(prismaMock.quote.update).toHaveBeenCalledWith({ where: { id: 'q-1' }, data: { status: 'EXPIRED' } })
  })

  it('switch_product changes product, resets the application, and does NOT delete answers (carry-over)', async () => {
    vi.mocked(resolveProductRef).mockResolvedValueOnce({ id: 'p-new', code: 'new', matchedBy: 'id' } as never)
    vi.mocked(resolveGroupCodes).mockResolvedValueOnce(['application'])
    vi.mocked(calculateProgress).mockResolvedValueOnce({ total: 6, answered: 0, percentage: 0 })
    prismaMock.application.findUnique.mockResolvedValueOnce({ id: 'app-1', conversationId: 'conv-1', productId: 'p-old', tierId: 't', levelId: 'l', includesAddon: true, status: 'OPEN', totalQuestions: 10 })
    prismaMock.quote.findFirst.mockResolvedValueOnce(null)

    const r = await switchProduct({ productId: 'p-new' }, CTX)

    expect(r.success).toBe(true)
    expect(prismaMock.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ productId: 'p-new' }) }))
    expect(prismaMock.application.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tierId: null, levelId: null, includesAddon: false, totalQuestions: 6 }) }))
    expect(prismaMock.answer.delete).not.toHaveBeenCalled()
    expect(prismaMock.answer.deleteMany).not.toHaveBeenCalled()
  })

  // The two mocked-prisma deriveState phase cases that lived here were retired
  // with lib/chat/derive-state.ts (A1.7); phase derivation is covered by the
  // pure predicate tests in __tests__/lib/engines/derive-and-expose.test.ts.
})
