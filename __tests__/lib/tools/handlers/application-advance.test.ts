import { describe, it, expect, vi, beforeEach } from 'vitest'

const convFindUniqueSpy = vi.fn()
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
    // B2.1: negative stamp cases fall through to the Dnt aggregate — none here.
    dnt: { findFirst: () => Promise.resolve(null) },
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

const { startApplication } = await import('@/lib/tools/handlers/application-handlers')

const CONTEXT = {
  db: (await import('@/lib/db')).prisma,
  conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const,
} as unknown as Parameters<typeof startApplication>[1]

describe('startApplication DNT gate', () => {
  beforeEach(() => {
    convFindUniqueSpy.mockReset(); convUpdateSpy.mockReset()
    appFindUniqueSpy.mockReset(); appCreateSpy.mockReset()
    calcProgressSpy.mockReset(); getNextQuestionSpy.mockReset()
    resolveCodesSpy.mockReset(); resolveActiveSpy.mockReset()
    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['application', 'bd_medical'])
    appFindUniqueSpy.mockResolvedValue(null) // no existing application
  })

  it('blocks when DNT is not signed', async () => {
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: null, dntValidUntil: null, candidateProductId: 'p-protect', productId: null })
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/DNT/i)
    expect(appCreateSpy).not.toHaveBeenCalled()
  })

  it('blocks when DNT signature has expired', async () => {
    convFindUniqueSpy.mockResolvedValue({
      dntSignedAt: new Date(Date.now() - 1_000_000_000),
      dntValidUntil: new Date(Date.now() - 1),
      candidateProductId: 'p-protect',
      productId: 'p-protect',
    })
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/DNT/i)
    expect(appCreateSpy).not.toHaveBeenCalled()
  })

  it('starts the application (product-derived groups) when DNT is signed', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60)
    convFindUniqueSpy.mockResolvedValue({ dntSignedAt: new Date(), dntValidUntil: future, candidateProductId: 'p-protect', productId: 'p-protect' })
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
