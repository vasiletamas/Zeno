import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    product: { findUnique: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')
const { GLOBAL_INSIGHT_KEYS, getActiveInsightKeys, findKeySpec } = await import('@/lib/insights/keys')

describe('GLOBAL_INSIGHT_KEYS', () => {
  it('includes age, smokingStatus, urgency', () => {
    const keys = GLOBAL_INSIGHT_KEYS.map(k => k.key)
    expect(keys).toContain('age')
    expect(keys).toContain('smokingStatus')
    expect(keys).toContain('urgency')
  })
  it('carries the PREFERENCE vocabulary (Task 3.1, D3) — the "Optim" memory class', () => {
    const byKey = Object.fromEntries(GLOBAL_INSIGHT_KEYS.map(k => [k.key, k]))
    expect(byKey.preferredTier).toMatchObject({ category: 'PREFERENCE' })
    expect(byKey.preferredLevel).toMatchObject({ category: 'PREFERENCE' })
    expect(byKey.addonInterest).toMatchObject({ category: 'PREFERENCE' })
    expect(byKey.budgetSensitivity).toMatchObject({ category: 'PREFERENCE', type: 'enum' })
    expect(byKey.budgetSensitivity.options).toEqual(['low', 'medium', 'high'])
    expect(byKey.preferredPaymentFrequency).toMatchObject({ category: 'PREFERENCE', type: 'enum' })
  })
})

describe('getActiveInsightKeys', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns only globals when productId is null', async () => {
    const result = await getActiveInsightKeys(null)
    expect(result).toEqual(GLOBAL_INSIGHT_KEYS)
    expect(prisma.product.findUnique).not.toHaveBeenCalled()
  })

  it('merges globals with product-specific keys', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      insightKeys: [
        { key: 'selectedTier', category: 'PREFERENCE', type: 'enum', options: ['Standard', 'Optim'] },
      ],
    } as never)
    const result = await getActiveInsightKeys('prod-1')
    expect(result.length).toBe(GLOBAL_INSIGHT_KEYS.length + 1)
    expect(result.find(k => k.key === 'selectedTier')).toBeDefined()
  })

  it('a product key OVERRIDES the global spec by key (Task 3.1: tiers are product-defined enums)', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({
      insightKeys: [
        { key: 'preferredTier', category: 'PREFERENCE', type: 'enum', options: ['standard', 'optim'] },
      ],
    } as never)
    const result = await getActiveInsightKeys('prod-1')
    const specs = result.filter(k => k.key === 'preferredTier')
    expect(specs).toHaveLength(1)
    expect(specs[0].type).toBe('enum')
    expect(specs[0].options).toEqual(['standard', 'optim'])
  })

  it('returns globals when product has null insightKeys', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue({ insightKeys: null } as never)
    const result = await getActiveInsightKeys('prod-1')
    expect(result).toEqual(GLOBAL_INSIGHT_KEYS)
  })

  it('returns globals when product not found', async () => {
    vi.mocked(prisma.product.findUnique).mockResolvedValue(null)
    const result = await getActiveInsightKeys('missing')
    expect(result).toEqual(GLOBAL_INSIGHT_KEYS)
  })
})

describe('findKeySpec', () => {
  it('returns the spec by key from a list', () => {
    const spec = findKeySpec(GLOBAL_INSIGHT_KEYS, 'age')
    expect(spec).toBeDefined()
    expect(spec?.category).toBe('DEMOGRAPHIC')
  })

  it('returns undefined for unknown key', () => {
    expect(findKeySpec(GLOBAL_INSIGHT_KEYS, 'bogus')).toBeUndefined()
  })
})
