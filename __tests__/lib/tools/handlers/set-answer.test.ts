import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeSnapshot } from '../../engines/snapshot-fixtures'

const qFindFirstSpy = vi.fn()
const answerUpsertSpy = vi.fn()
const appFindUniqueSpy = vi.fn()
const appUpdateSpy = vi.fn()
const tierFindFirstSpy = vi.fn()
const levelFindFirstSpy = vi.fn()
const insightFindUniqueSpy = vi.fn()
const loadSnapshotSpy = vi.fn()
const resolveCodesSpy = vi.fn()
const resolveActiveSpy = vi.fn()
const validateAnswerSpy = vi.fn()
const bumpInsightSpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    question: { findFirst: (...a: unknown[]) => qFindFirstSpy(...a) },
    answer: { upsert: (...a: unknown[]) => answerUpsertSpy(...a) },
    application: {
      findUnique: (...a: unknown[]) => appFindUniqueSpy(...a),
      update: (...a: unknown[]) => appUpdateSpy(...a),
    },
    pricingTier: { findFirst: (...a: unknown[]) => tierFindFirstSpy(...a) },
    pricingLevel: { findFirst: (...a: unknown[]) => levelFindFirstSpy(...a) },
    customerInsight: { findUnique: (...a: unknown[]) => insightFindUniqueSpy(...a) },
  },
}))

vi.mock('@/lib/engines/question-groups', () => ({
  resolveGroupCodes: (...a: unknown[]) => resolveCodesSpy(...a),
  resolveActiveProductId: (...a: unknown[]) => resolveActiveSpy(...a),
}))

vi.mock('@/lib/engines/questionnaire-engine', () => ({
  validateAnswer: (...a: unknown[]) => validateAnswerSpy(...a),
}))

vi.mock('@/lib/engines/snapshot-loader', () => ({
  loadDomainSnapshot: (...a: unknown[]) => loadSnapshotSpy(...a),
}))

vi.mock('@/lib/tools/handlers/insight-bump', () => ({
  bumpInsightOnAnswer: (...a: unknown[]) => bumpInsightSpy(...a),
}))

const { setAnswer } = await import('@/lib/tools/handlers/set-answer-handlers')

const CONTEXT = {
  customerId: 'cust-1',
  conversationId: 'conv-1',
  language: 'ro' as const,
}

describe('setAnswer', () => {
  beforeEach(() => {
    qFindFirstSpy.mockReset()
    answerUpsertSpy.mockReset()
    appFindUniqueSpy.mockReset()
    appUpdateSpy.mockReset()
    tierFindFirstSpy.mockReset()
    levelFindFirstSpy.mockReset()
    insightFindUniqueSpy.mockReset()
    loadSnapshotSpy.mockReset()
    resolveCodesSpy.mockReset()
    resolveActiveSpy.mockReset()
    validateAnswerSpy.mockReset()
    bumpInsightSpy.mockReset()

    resolveActiveSpy.mockResolvedValue('p-protect')
    resolveCodesSpy.mockResolvedValue(['dnt_consent', 'application'])
    insightFindUniqueSpy.mockResolvedValue(null)
    loadSnapshotSpy.mockResolvedValue(
      makeSnapshot({
        product: { id: 'p-protect', code: 'protect', insuranceType: 'LIFE' },
        application: { id: 'app-1', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 1, requiredCount: 5, missingCodes: ['Q2', 'Q3'] },
        answers: { HAS_DEPENDENTS: 'true' },
      }),
    )
  })

  it('saves answer to normal question and returns fresh state', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-has-dep', code: 'HAS_DEPENDENTS', type: 'BOOLEAN', options: [],
      validationRules: {}, group: { code: 'dnt_consent' }, insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'true' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-has-dep', value: 'true' })

    const result = await setAnswer({ questionCode: 'HAS_DEPENDENTS', value: 'yes' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(true)
    expect(answerUpsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { questionId_conversationId: { questionId: 'q-has-dep', conversationId: 'conv-1' } },
      create: expect.objectContaining({ value: 'true' }),
      update: expect.objectContaining({ value: 'true' }),
    }))
    expect(loadSnapshotSpy).toHaveBeenCalledWith('conv-1')
    expect(result.data?.state).toBeDefined()
    expect(result.data?.actions).toBeDefined()
    expect(result.confirmation).toEqual(expect.objectContaining({
      category: 'save', value: 'true', timestamp: expect.any(String),
    }))
  })

  it('overwrites existing answer', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-has-dep', code: 'HAS_DEPENDENTS', type: 'BOOLEAN', options: [],
      validationRules: {}, group: { code: 'dnt_consent' }, insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'false' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-has-dep', value: 'false' })

    const result = await setAnswer({ questionCode: 'HAS_DEPENDENTS', value: 'no' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(true)
    expect(answerUpsertSpy).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ value: 'false', answeredAt: expect.any(Date) }),
    }))
  })

  it('handles PACKAGE_CHOICE: resolves tier, updates Application', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-pkg', code: 'PACKAGE_CHOICE', type: 'DROPDOWN',
      options: [{ value: 'standard' }, { value: 'premium' }],
      validationRules: {}, group: { code: 'application' }, insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'standard' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-pkg', value: 'standard' })
    appFindUniqueSpy.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', productId: 'p-protect',
      tierId: null, levelId: null, includesAddon: false,
    })
    tierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-standard', code: 'standard' })
    appUpdateSpy.mockResolvedValueOnce({ id: 'app-1', tierId: 'tier-standard' })

    const result = await setAnswer({ questionCode: 'PACKAGE_CHOICE', value: 'standard' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(true)
    expect(tierFindFirstSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: 'p-protect', code: 'standard' },
    }))
    expect(appUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tierId: 'tier-standard' }),
    }))
  })

  it('handles PREMIUM_LEVEL: resolves level, updates Application', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-level', code: 'PREMIUM_LEVEL', type: 'DROPDOWN',
      options: [{ value: 'level_1' }, { value: 'level_2' }],
      validationRules: {}, group: { code: 'application' }, insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'level_1' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-level', value: 'level_1' })
    appFindUniqueSpy.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', productId: 'p-protect',
      tierId: 'tier-standard', levelId: null, includesAddon: false,
    })
    levelFindFirstSpy.mockResolvedValueOnce({ id: 'level-1', code: 'level_1' })
    appUpdateSpy.mockResolvedValueOnce({ id: 'app-1', levelId: 'level-1' })

    const result = await setAnswer({ questionCode: 'PREMIUM_LEVEL', value: 'level_1' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(true)
    expect(levelFindFirstSpy).toHaveBeenCalledWith(expect.objectContaining({
      where: { tierId: 'tier-standard', code: 'level_1' },
    }))
    expect(appUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ levelId: 'level-1' }),
    }))
  })

  it('handles BD_ADDON_INTEREST: normalizes boolean and updates Application.includesAddon', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-addon', code: 'BD_ADDON_INTEREST', type: 'BOOLEAN', options: [],
      validationRules: {}, group: { code: 'application' }, insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'true' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-addon', value: 'true' })
    appFindUniqueSpy.mockResolvedValueOnce({
      id: 'app-1', conversationId: 'conv-1', productId: 'p-protect',
      tierId: 'tier-standard', levelId: 'level-1', includesAddon: false,
    })
    appUpdateSpy.mockResolvedValueOnce({ id: 'app-1', includesAddon: true })

    const result = await setAnswer({ questionCode: 'BD_ADDON_INTEREST', value: 'true' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(true)
    expect(appUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ includesAddon: true }),
    }))
  })

  it('rejects invalid answer', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-pkg', code: 'PACKAGE_CHOICE', type: 'DROPDOWN',
      options: [{ value: 'standard' }, { value: 'premium' }],
      validationRules: {}, group: { code: 'application' }, insightKey: null,
    })
    validateAnswerSpy.mockReturnValueOnce({
      valid: false, normalizedValue: 'invalid', error: 'Invalid option. Valid options: standard, premium',
    })

    const result = await setAnswer({ questionCode: 'PACKAGE_CHOICE', value: 'invalid' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Invalid option/)
    expect(answerUpsertSpy).not.toHaveBeenCalled()
  })

  it('returns error when question code not found', async () => {
    qFindFirstSpy.mockResolvedValueOnce(null)

    const result = await setAnswer({ questionCode: 'NONEXISTENT', value: 'foo' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Question code.*not found/)
  })

  it('bumps insight when question has insightKey', async () => {
    qFindFirstSpy.mockResolvedValueOnce({
      id: 'q-medical', code: 'HAS_MEDICAL_CONDITION', type: 'BOOLEAN', options: [],
      validationRules: {}, group: { code: 'bd_medical', id: 'grp-bd' }, insightKey: 'bd_health_history',
    })
    validateAnswerSpy.mockReturnValueOnce({ valid: true, normalizedValue: 'true' })
    answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-medical', value: 'true' })
    insightFindUniqueSpy.mockResolvedValueOnce(null)

    await setAnswer({ questionCode: 'HAS_MEDICAL_CONDITION', value: 'true' }, CONTEXT as Parameters<typeof setAnswer>[1])

    expect(bumpInsightSpy).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cust-1', conversationId: 'conv-1', answerValue: 'true',
    }))
  })
})
