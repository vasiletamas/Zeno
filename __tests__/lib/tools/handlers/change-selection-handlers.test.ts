import { describe, it, expect, vi, beforeEach } from 'vitest'

const applicationFindUniqueSpy = vi.fn()
const applicationUpdateSpy = vi.fn()
const quoteFindUniqueSpy = vi.fn()
const quoteUpdateSpy = vi.fn()
const pricingTierFindFirstSpy = vi.fn()
const pricingLevelFindFirstSpy = vi.fn()
const answerUpsertSpy = vi.fn()
const questionFindManySpy = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    application: {
      findUnique: (...args: unknown[]) => applicationFindUniqueSpy(...args),
      update: (...args: unknown[]) => applicationUpdateSpy(...args),
    },
    quote: {
      findUnique: (...args: unknown[]) => quoteFindUniqueSpy(...args),
      update: (...args: unknown[]) => quoteUpdateSpy(...args),
    },
    pricingTier: { findFirst: (...args: unknown[]) => pricingTierFindFirstSpy(...args) },
    pricingLevel: { findFirst: (...args: unknown[]) => pricingLevelFindFirstSpy(...args) },
    answer: { upsert: (...args: unknown[]) => answerUpsertSpy(...args) },
    question: { findMany: (...args: unknown[]) => questionFindManySpy(...args) },
  },
}))

const { changeSelection } = await import('@/lib/tools/handlers/change-selection-handlers')

const CONTEXT = {
  db: (await import('@/lib/db')).prisma,
  conversationId: 'conv-1',
  customerId: 'cust-1',
  language: 'ro' as const,
} as unknown as Parameters<typeof changeSelection>[1]

describe('changeSelection', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('tier change', () => {
    it('resolves tier code to id, updates Application.tierId, expires DRAFT quote, upserts PACKAGE_CHOICE answer, returns confirmation', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-standard-1', levelId: 'level-1-1', includesAddon: false })
      pricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-optim-1', code: 'optim', name: { ro: 'Optim', en: 'Optim' } })
      quoteFindUniqueSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'DRAFT' })
      quoteUpdateSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'EXPIRED' })
      questionFindManySpy.mockResolvedValueOnce([{ id: 'q-pkg', code: 'PACKAGE_CHOICE' }])
      answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-pkg', conversationId: 'conv-1', value: 'optim' })
      applicationUpdateSpy.mockResolvedValueOnce({ id: 'app-1', tierId: 'tier-optim-1' })

      const result = await changeSelection({ tier: 'optim' }, CONTEXT)

      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ selectionChanged: true, applicationId: 'app-1', tierCode: 'optim' })
      expect(result.confirmation).toMatchObject({ category: 'lifecycle', label: expect.stringContaining('tier'), timestamp: expect.any(String) })
      expect(applicationUpdateSpy).toHaveBeenCalledWith({ where: { id: 'app-1' }, data: { tierId: 'tier-optim-1' } })
      expect(quoteUpdateSpy).toHaveBeenCalledWith({ where: { id: 'quote-1' }, data: { status: 'EXPIRED' } })
    })

    it('returns error and does not mutate when tier code is invalid', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-1' })
      pricingTierFindFirstSpy.mockResolvedValueOnce(null)
      const result = await changeSelection({ tier: 'invalid-tier' }, CONTEXT)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/tier.*not found/i)
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
      expect(quoteUpdateSpy).not.toHaveBeenCalled()
    })

    it('is a no-op when tier is already set to the same value', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-optim-1' })
      pricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-optim-1', code: 'optim' })
      const result = await changeSelection({ tier: 'optim' }, CONTEXT)
      expect(result.success).toBe(true)
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
      expect(quoteUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('level change', () => {
    it('resolves level code to id, updates Application.levelId, expires quote, upserts PREMIUM_LEVEL answer', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-1', levelId: 'level-1-1', includesAddon: false })
      pricingLevelFindFirstSpy.mockResolvedValueOnce({ id: 'level-1-2', code: 'level_2', name: { ro: 'Nivel 2', en: 'Level 2' } })
      quoteFindUniqueSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'DRAFT' })
      quoteUpdateSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'EXPIRED' })
      questionFindManySpy.mockResolvedValueOnce([{ id: 'q-level', code: 'PREMIUM_LEVEL' }])
      answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-level', conversationId: 'conv-1', value: 'level_2' })
      applicationUpdateSpy.mockResolvedValueOnce({ id: 'app-1', levelId: 'level-1-2' })
      const result = await changeSelection({ level: 'level_2' }, CONTEXT)
      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ levelCode: 'level_2' })
    })

    it('returns error when level code is invalid', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-1', levelId: 'level-1' })
      pricingLevelFindFirstSpy.mockResolvedValueOnce(null)
      const result = await changeSelection({ level: 'invalid-level' }, CONTEXT)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/level.*not found/i)
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('addon change', () => {
    it('updates Application.includesAddon, upserts BD_ADDON_INTEREST answer, expires quote', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-1', levelId: 'level-1', includesAddon: false })
      quoteFindUniqueSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'DRAFT' })
      quoteUpdateSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'EXPIRED' })
      questionFindManySpy.mockResolvedValueOnce([{ id: 'q-addon', code: 'BD_ADDON_INTEREST' }])
      answerUpsertSpy.mockResolvedValueOnce({ questionId: 'q-addon', conversationId: 'conv-1', value: 'true' })
      applicationUpdateSpy.mockResolvedValueOnce({ id: 'app-1', includesAddon: true })
      const result = await changeSelection({ addon: true }, CONTEXT)
      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ addonIncluded: true })
      expect(applicationUpdateSpy).toHaveBeenCalledWith({ where: { id: 'app-1' }, data: { includesAddon: true } })
    })

    it('does not expire quote when addon is already set to the same value', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-1', levelId: 'level-1', includesAddon: true })
      const result = await changeSelection({ addon: true }, CONTEXT)
      expect(result.success).toBe(true)
      expect(quoteUpdateSpy).not.toHaveBeenCalled()
      expect(applicationUpdateSpy).not.toHaveBeenCalled()
    })
  })

  describe('combined changes', () => {
    it('changes tier and level together, expires one quote, upserts both answers', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce({ id: 'app-1', productId: 'prod-1', tierId: 'tier-standard-1', levelId: 'level-1-1', includesAddon: false })
      pricingTierFindFirstSpy.mockResolvedValueOnce({ id: 'tier-optim-1', code: 'optim' })
      pricingLevelFindFirstSpy.mockResolvedValueOnce({ id: 'level-optim-3', code: 'level_3' })
      quoteFindUniqueSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'DRAFT' })
      quoteUpdateSpy.mockResolvedValueOnce({ id: 'quote-1', status: 'EXPIRED' })
      questionFindManySpy.mockResolvedValueOnce([{ id: 'q-pkg', code: 'PACKAGE_CHOICE' }, { id: 'q-level', code: 'PREMIUM_LEVEL' }])
      answerUpsertSpy.mockResolvedValueOnce({ value: 'optim' })
      answerUpsertSpy.mockResolvedValueOnce({ value: 'level_3' })
      applicationUpdateSpy.mockResolvedValueOnce({ id: 'app-1', tierId: 'tier-optim-1', levelId: 'level-optim-3' })
      const result = await changeSelection({ tier: 'optim', level: 'level_3' }, CONTEXT)
      expect(result.success).toBe(true)
      expect(result.data).toMatchObject({ tierCode: 'optim', levelCode: 'level_3' })
      expect(quoteUpdateSpy).toHaveBeenCalledTimes(1)
      expect(answerUpsertSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('returns error when no application exists', async () => {
      applicationFindUniqueSpy.mockResolvedValueOnce(null)
      const result = await changeSelection({ tier: 'optim' }, CONTEXT)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/no.*application/i)
    })

    it('returns error when no changes are requested (all params undefined)', async () => {
      const result = await changeSelection({}, CONTEXT)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/no.*changes/i)
    })
  })
})
