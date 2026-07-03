import { describe, it, expect, vi, beforeEach } from 'vitest'

const productFindManySpy = vi.fn()
const resolveProductRefSpy = vi.fn()
const listAvailableProductRefsSpy = vi.fn()

vi.mock('@/lib/db', () => ({ prisma: {
  product: { findMany: (...a: unknown[]) => productFindManySpy(...a) },
  // E1.8: compare_products reads published content — none in these unit specs
  productContent: { findMany: async () => [] },
  coverageAmount: { findMany: async () => [] },
} }))
vi.mock('@/lib/tools/resolve-product', () => ({
  resolveProductRef: (...a: unknown[]) => resolveProductRefSpy(...a),
  listAvailableProductRefs: (...a: unknown[]) => listAvailableProductRefsSpy(...a),
}))

const { compareProducts } = await import('@/lib/tools/handlers/product-handlers')
const CONTEXT = { conversationId: 'c1', customerId: 'cust1', language: 'ro' as const } as unknown as Parameters<typeof compareProducts>[1]

function product(id: string, code: string) {
  return {
    id, code, name: { en: code, ro: code }, description: { en: 'd', ro: 'd' },
    insuranceType: 'LIFE', subType: 'TERM',
    targetCustomer: null, contractTerm: null,
    pricingTiers: [{ code: 'basic', name: { en: 'Basic', ro: 'Bază' }, levels: [
      { code: 'l1', name: { en: 'L1', ro: 'N1' }, premiumAnnual: 290, currency: 'RON' },
      { code: 'l2', name: { en: 'L2', ro: 'N2' }, premiumAnnual: 350, currency: 'RON' },
    ] }],
    addons: [],
  }
}

describe('compareProducts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('E1.8: NO premium numbers pre-quote; claims are published key points, structure kept', async () => {
    resolveProductRefSpy.mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce({ id: 'p2' })
    productFindManySpy.mockResolvedValueOnce([product('p1', 'protect'), product('p2', 'secure')])

    const result = await compareProducts({ productIds: ['p1', 'p2'] }, CONTEXT)

    expect(result.success).toBe(true)
    const comparison = (result.data as { comparison: Array<Record<string, unknown>> }).comparison
    expect(comparison).toHaveLength(2)
    for (const prod of comparison) {
      expect(prod).not.toHaveProperty('premiumRange') // legacy authored range GONE
      expect(prod).not.toHaveProperty('features')     // legacy claims GONE
      expect(prod).toHaveProperty('key_value_product_points') // published claims surface
      for (const tier of (prod.tiers as Array<{ levels: Array<Record<string, unknown>> }>)) {
        for (const level of tier.levels) {
          expect(level).not.toHaveProperty('premiumAnnual') // leak closed
          expect(level).toHaveProperty('code')              // structure kept
          expect(level).toHaveProperty('name')
        }
      }
    }
    // No premium number appears anywhere in a pre-quote comparison
    expect(JSON.stringify(result.data)).not.toContain('350')
    expect(JSON.stringify(result.data)).not.toContain('290')
  })

  it('requires at least 2 product IDs', async () => {
    const result = await compareProducts({ productIds: ['only-one'] }, CONTEXT)
    expect(result.success).toBe(false)
  })
})
