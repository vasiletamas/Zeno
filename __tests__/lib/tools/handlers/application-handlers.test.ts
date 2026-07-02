import { describe, it, expect, vi, beforeEach } from 'vitest'

const prismaApplicationCreateSpy = vi.fn()
const prismaApplicationFindUniqueSpy = vi.fn()
const prismaConversationFindUniqueSpy = vi.fn()
const prismaConversationUpdateSpy = vi.fn()
const prismaPricingTierFindFirstSpy = vi.fn()
const prismaPricingLevelFindFirstSpy = vi.fn()
const prismaQuestionFindFirstSpy = vi.fn()
const prismaAnswerUpsertSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    application: { create: (...a: unknown[]) => prismaApplicationCreateSpy(...a), findUnique: (...a: unknown[]) => prismaApplicationFindUniqueSpy(...a), update: vi.fn() },
    conversation: { findUnique: (...a: unknown[]) => prismaConversationFindUniqueSpy(...a), update: (...a: unknown[]) => prismaConversationUpdateSpy(...a) },
    pricingTier: { findFirst: (...a: unknown[]) => prismaPricingTierFindFirstSpy(...a) },
    pricingLevel: { findFirst: (...a: unknown[]) => prismaPricingLevelFindFirstSpy(...a) },
    question: { findFirst: (...a: unknown[]) => prismaQuestionFindFirstSpy(...a) },
    answer: { upsert: (...a: unknown[]) => prismaAnswerUpsertSpy(...a) },
    // B2.6: the DNT gate reads the customer-scoped Dnt aggregate.
    dnt: { findFirst: () => Promise.resolve({ id: 'dnt-1', status: 'ACTIVE', signedAt: new Date(), validUntil: new Date(Date.now() + 3600e3), productTypesCovered: ['LIFE'] }) },
    // B3.ADD-3: the soft verification offer derives the identity tier.
    customerProfileField: { findMany: () => Promise.resolve([]) },
    verificationChallenge: { findMany: () => Promise.resolve([]) },
  },
}))
vi.mock('@/lib/engines/questionnaire-engine', () => ({ getNextQuestion: vi.fn(), validateAnswer: vi.fn(), checkForFlags: vi.fn(), calculateProgress: vi.fn() }))
vi.mock('@/lib/engines/question-groups', () => ({ resolveGroupCodes: vi.fn(), resolveActiveProductId: vi.fn() }))
vi.mock('@/lib/analytics/events', () => ({ trackProductSelected: vi.fn() }))
vi.mock('./insight-bump', () => ({ bumpInsightOnAnswer: vi.fn() }))

const { startApplication } = await import('@/lib/tools/handlers/application-handlers')
const { resolveGroupCodes } = await import('@/lib/engines/question-groups')
const { getNextQuestion, calculateProgress } = await import('@/lib/engines/questionnaire-engine')

const CONTEXT = {
  db: (await import('@/lib/db')).prisma, conversationId: 'conv-1', customerId: 'cust-1', language: 'ro' as const } as unknown as Parameters<typeof startApplication>[1]

function mockHappyPathPreamble() {
  prismaConversationFindUniqueSpy.mockResolvedValueOnce({ id: 'conv-1', productId: 'prod-1', candidateProductId: null })
  prismaApplicationFindUniqueSpy.mockResolvedValueOnce(null)
  vi.mocked(resolveGroupCodes).mockResolvedValueOnce(['application_basic'])
  vi.mocked(calculateProgress).mockResolvedValueOnce({ answered: 0, total: 10, percentage: 0 })
}

describe('startApplication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates application with tierId/levelId/includesAddon and upserts the 3 selection answers', async () => {
    mockHappyPathPreamble()
    prismaPricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-1', code: 'standard', productId: 'prod-1' })
    prismaPricingLevelFindFirstSpy.mockResolvedValueOnce({ id: 'level-1', code: 'level_2', tierId: 'tier-1' })
    prismaApplicationCreateSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', status: 'OPEN', tierId: 'tier-1', levelId: 'level-1', includesAddon: true })
    prismaQuestionFindFirstSpy
      .mockResolvedValueOnce({ id: 'q-package', code: 'PACKAGE_CHOICE' })
      .mockResolvedValueOnce({ id: 'q-level', code: 'PREMIUM_LEVEL' })
      .mockResolvedValueOnce({ id: 'q-addon', code: 'BD_ADDON_INTEREST' })
    prismaAnswerUpsertSpy.mockResolvedValue({ id: 'ans-1' })
    vi.mocked(getNextQuestion).mockResolvedValueOnce({ question: { id: 'q-age', code: 'AGE', text: { ro: 'Vârsta?', en: 'Age?' }, type: 'text', options: null, helpText: null } as never, progress: { answered: 3, total: 10 } })

    const result = await startApplication({ tierCode: 'standard', levelCode: 'level_2', includesAddon: true }, CONTEXT)

    expect(result.success).toBe(true)
    expect(prismaApplicationCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tierId: 'tier-1', levelId: 'level-1', includesAddon: true }) }))
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledTimes(3)
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ questionId: 'q-package', value: 'standard' }) }))
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ questionId: 'q-level', value: 'level_2' }) }))
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ questionId: 'q-addon', value: 'true' }) }))
  })

  it('returns error when tierCode does not resolve', async () => {
    mockHappyPathPreamble()
    prismaPricingTierFindFirstSpy.mockResolvedValueOnce(null)
    const result = await startApplication({ tierCode: 'invalid', levelCode: 'level_2', includesAddon: false }, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/tier.*not found/i)
    expect(prismaApplicationCreateSpy).not.toHaveBeenCalled()
  })

  it('returns error when levelCode does not resolve', async () => {
    mockHappyPathPreamble()
    prismaPricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-1', code: 'standard' })
    prismaPricingLevelFindFirstSpy.mockResolvedValueOnce(null)
    const result = await startApplication({ tierCode: 'standard', levelCode: 'invalid', includesAddon: false }, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/level.*not found/i)
    expect(prismaApplicationCreateSpy).not.toHaveBeenCalled()
  })

  it('legacy: no args → no selection upserts, nulls on application', async () => {
    mockHappyPathPreamble()
    prismaApplicationCreateSpy.mockResolvedValueOnce({ id: 'app-1', status: 'OPEN', tierId: null, levelId: null, includesAddon: false })
    vi.mocked(getNextQuestion).mockResolvedValueOnce({ question: { id: 'q-package', code: 'PACKAGE_CHOICE', text: { ro: 'Pachet?', en: 'Package?' }, type: 'select', options: [], helpText: null } as never, progress: { answered: 0, total: 10 } })
    const result = await startApplication({}, CONTEXT)
    expect(result.success).toBe(true)
    expect(prismaAnswerUpsertSpy).not.toHaveBeenCalled()
  })

  it('levelCode without tierCode errors and creates no app', async () => {
    mockHappyPathPreamble()
    const result = await startApplication({ levelCode: 'level_2' }, CONTEXT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/levelCode requires tierCode/i)
    expect(prismaApplicationCreateSpy).not.toHaveBeenCalled()
  })

  it('includesAddon: false still records the BD_ADDON_INTEREST answer (1 upsert)', async () => {
    mockHappyPathPreamble()
    prismaApplicationCreateSpy.mockResolvedValueOnce({ id: 'app-1', status: 'OPEN', tierId: null, levelId: null, includesAddon: false })
    prismaQuestionFindFirstSpy.mockResolvedValueOnce({ id: 'q-addon', code: 'BD_ADDON_INTEREST' })
    prismaAnswerUpsertSpy.mockResolvedValue({ id: 'ans-1' })
    vi.mocked(getNextQuestion).mockResolvedValueOnce({ question: { id: 'q-age', code: 'AGE', text: { ro: 'Vârsta?', en: 'Age?' }, type: 'text', options: null, helpText: null } as never, progress: { answered: 1, total: 10 } })
    const result = await startApplication({ includesAddon: false }, CONTEXT)
    expect(result.success).toBe(true)
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledTimes(1)
    expect(prismaAnswerUpsertSpy).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ questionId: 'q-addon', value: 'false' }) }))
  })
})
