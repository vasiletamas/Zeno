import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUniqueSpy = vi.fn()
const dntFindFirstSpy = vi.fn()
const convUpdateSpy = vi.fn()
const appFindUniqueSpy = vi.fn()
const appCreateSpy = vi.fn()
const calcProgressSpy = vi.fn()
const getNextQuestionSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: {
      findUnique: (...a: unknown[]) => convFindUniqueSpy(...a),
      update: (...a: unknown[]) => convUpdateSpy(...a),
    },
    application: {
      findUnique: (...a: unknown[]) => appFindUniqueSpy(...a),
      create: (...a: unknown[]) => appCreateSpy(...a),
    },
    // B2.6: the DNT gate reads the customer-scoped Dnt aggregate.
    dnt: { findFirst: (...a: unknown[]) => dntFindFirstSpy(...a) },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({
  calculateProgress: (...a: unknown[]) => calcProgressSpy(...a),
  getNextQuestion: (...a: unknown[]) => getNextQuestionSpy(...a),
  validateAnswer: vi.fn(),
}))
vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
  resolveActiveProductId: (...a: unknown[]) => resolveActiveSpy(...a),
}))
vi.mock('@/lib/analytics/events', () => ({ trackProductSelected: vi.fn(), trackDntCompleted: vi.fn() }))

const { startApplication } = await import('@/lib/tools/handlers/application-handlers')

const CONTEXT = {
  db: (await import('@/lib/db')).prisma,
  conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const,
} as unknown as Parameters<typeof startApplication>[1]

const VALID_DNT = { id: 'dnt-1', status: 'ACTIVE', signedAt: new Date(), validUntil: new Date(Date.now() + 1000 * 60 * 60), productTypesCovered: ['LIFE'] }
const EXPIRED_DNT = { ...VALID_DNT, validUntil: new Date(Date.now() - 1) }

describe('startApplication DNT gate', () => {
  beforeEach(() => {
    convFindUniqueSpy.mockReset(); convUpdateSpy.mockReset()
    appFindUniqueSpy.mockReset(); appCreateSpy.mockReset()
    calcProgressSpy.mockReset(); getNextQuestionSpy.mockReset()
    resolveCodesSpy.mockReset(); resolveActiveSpy.mockReset()
    dntFindFirstSpy.mockReset()
    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['application', 'bd_medical'])
    appFindUniqueSpy.mockResolvedValue(null) // no existing application
    convFindUniqueSpy.mockResolvedValue({ candidateProductId: 'p-protect', productId: 'p-protect' })
  })

  it('blocks when the customer has no Dnt (aggregate gate, B2.6)', async () => {
    dntFindFirstSpy.mockResolvedValue(null)
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/DNT/i)
    expect(appCreateSpy).not.toHaveBeenCalled()
  })

  it('blocks when the Dnt has expired', async () => {
    dntFindFirstSpy.mockResolvedValue(EXPIRED_DNT)
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/DNT/i)
    expect(appCreateSpy).not.toHaveBeenCalled()
  })

  it('starts the application (product-derived groups) when the customer holds a valid Dnt', async () => {
    dntFindFirstSpy.mockResolvedValue(VALID_DNT)
    calcProgressSpy.mockResolvedValueOnce({ answered: 0, total: 11, percentage: 0 })
    appCreateSpy.mockResolvedValueOnce({ id: 'app-1' })
    getNextQuestionSpy.mockResolvedValueOnce({
      question: { id: 'q1', code: 'PACKAGE_CHOICE', text: { ro: 'Ce pachet?', en: 'Which package?' }, helpText: null, type: 'DROPDOWN', options: [] },
      progress: { answered: 0, total: 11, percentage: 0 },
    })

    const result = await startApplication({}, CONTEXT)

    expect(result.success).toBe(true)
    expect(resolveCodesSpy).toHaveBeenCalledWith('p-protect', 'application')
    expect(appCreateSpy).toHaveBeenCalled()
  })
})
