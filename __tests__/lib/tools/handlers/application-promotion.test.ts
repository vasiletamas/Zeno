import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUnique = vi.fn()
const appFindUnique = vi.fn()
const appCreate = vi.fn()
const convUpdate = vi.fn()
const calculateProgressSpy = vi.fn()
const getNextQuestionSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findUnique: (...args: unknown[]) => convFindUnique(...args),
      update: (...args: unknown[]) => convUpdate(...args),
    },
    application: {
      findUnique: (...args: unknown[]) => appFindUnique(...args),
      create: (...args: unknown[]) => appCreate(...args),
    },
    // B2.6: the DNT gate reads the customer-scoped Dnt aggregate.
    dnt: { findFirst: () => Promise.resolve({ id: 'dnt-1', status: 'ACTIVE', signedAt: new Date(), validUntil: new Date(Date.now() + 3600e3), productTypesCovered: ['LIFE'] }) },
    // B3.ADD-3: the soft verification offer derives the identity tier.
    customerProfileField: { findMany: () => Promise.resolve([]) },
    verificationChallenge: { findMany: () => Promise.resolve([]) },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  getNextQuestion: (...args: unknown[]) => getNextQuestionSpy(...args),
  validateAnswer: vi.fn(),
  checkForFlags: vi.fn(),
  calculateProgress: (...args: unknown[]) => calculateProgressSpy(...args),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...args: unknown[]) => resolveCodesSpy(...args),
  resolveActiveProductId: (...args: unknown[]) => resolveActiveSpy(...args),
}))
vi.mock('@/lib/analytics/events', () => ({ trackProductSelected: vi.fn() }))
vi.mock('./insight-bump', () => ({ bumpInsightOnAnswer: vi.fn() }))

const { startApplication } = await import('@/lib/tools/handlers/application-handlers')

const baseCtx = {
  db: (await import('@/lib/db')).prisma,
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
  workflowSession: null,
} as unknown as Parameters<typeof startApplication>[1]

beforeEach(() => {
  convFindUnique.mockReset(); appFindUnique.mockReset(); appCreate.mockReset()
  convUpdate.mockReset()
  calculateProgressSpy.mockReset(); getNextQuestionSpy.mockReset()
  resolveCodesSpy.mockReset(); resolveActiveSpy.mockReset()
  // defaults that satisfy the resolver for all tests
  resolveActiveSpy.mockResolvedValue('p-protect')
  resolveCodesSpy.mockResolvedValue(['application', 'bd_medical'])
})

describe('startApplication — candidate promotion', () => {
  it('promotes candidateProductId when context.product is absent', async () => {
    appFindUnique.mockResolvedValueOnce(null)
    // conversation query now covers DNT gate + product resolution in one shot
    convFindUnique.mockResolvedValueOnce({ candidateProductId: 'p-protect', productId: null })
    calculateProgressSpy.mockResolvedValueOnce({ total: 10, answered: 0, percentage: 0 })
    appCreate.mockResolvedValueOnce({ id: 'app-1' })
    getNextQuestionSpy.mockResolvedValueOnce({
      question: { id: 'q1', code: 'NAME', text: { ro: 'Nume?', en: 'Name?' }, helpText: null, type: 'TEXT', options: null },
      progress: { total: 10, answered: 0, percentage: 0 },
    })

    const r = await startApplication({}, baseCtx)

    expect(r.success).toBe(true)
    expect(appCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ productId: 'p-protect' }),
    }))
    expect(convUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ productId: 'p-protect' }),
    }))
  })

  it('returns failure when neither context.product nor candidate is set', async () => {
    appFindUnique.mockResolvedValueOnce(null)
    // DNT is signed but no product — should hit the "no product" error
    convFindUnique.mockResolvedValueOnce({ candidateProductId: null, productId: null })

    const r = await startApplication({}, baseCtx)

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/no product/i)
  })
})
