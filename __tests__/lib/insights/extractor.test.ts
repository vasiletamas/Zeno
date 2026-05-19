import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: vi.fn() },
}))
vi.mock('@/lib/errors/logger', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
}))
vi.mock('@/lib/insights/keys', () => ({
  getActiveInsightKeys: vi.fn(),
  findKeySpec: (active: Array<{key: string}>, key: string) => active.find(s => s.key === key),
  GLOBAL_INSIGHT_KEYS: [
    { key: 'age', category: 'DEMOGRAPHIC', type: 'number' },
    { key: 'urgency', category: 'BUYING_SIGNAL', type: 'enum', options: ['immediate', 'weeks', 'exploring'] },
  ],
}))

const { prisma } = await import('@/lib/db')
const { gateway } = await import('@/lib/llm/gateway')
const { logWarn } = await import('@/lib/errors/logger')
const { getActiveInsightKeys } = await import('@/lib/insights/keys')
const { extractAndPersistInsights } = await import('@/lib/insights/extractor')

const ACTIVE = [
  { key: 'age', category: 'DEMOGRAPHIC', type: 'number' as const },
  { key: 'selectedTier', category: 'PREFERENCE', type: 'enum' as const, options: ['Standard', 'Optim'] },
]

describe('extractAndPersistInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActiveInsightKeys).mockResolvedValue(ACTIVE as never)
  })

  it('upserts valid keys, drops unknown keys with warn', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        insights: [
          { key: 'age', value: 40, confidence: 0.9 },
          { key: 'bogusKey', value: 'x', confidence: 0.8 },
        ],
      }),
    } as never)

    await extractAndPersistInsights({
      message: 'Am 40 de ani',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: 'prod-1',
      mode: 'SALES',
      traceId: 't-1',
    })

    expect(prisma.customerInsight.upsert).toHaveBeenCalledTimes(1)
    const args = vi.mocked(prisma.customerInsight.upsert).mock.calls[0][0]
    expect(args.create.key).toBe('age')
    expect(args.create.category).toBe('DEMOGRAPHIC')
    expect(args.create.value).toBe('40')
    expect(args.create.confidence).toBe(0.9)
    expect(args.create.productId).toBeNull()
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'extractor_drift' }),
    )
  })

  it('stamps productId on per-product keys', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        insights: [{ key: 'selectedTier', value: 'Standard', confidence: 0.85 }],
      }),
    } as never)

    await extractAndPersistInsights({
      message: 'vreau Standard',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: 'prod-1',
      mode: 'SALES',
      traceId: 't-1',
    })

    const args = vi.mocked(prisma.customerInsight.upsert).mock.calls[0][0]
    expect(args.create.productId).toBe('prod-1')
    expect(args.create.category).toBe('PREFERENCE')
  })

  it('stamps productId on per-product BUYING_SIGNAL keys (by origin, not category)', async () => {
    vi.mocked(getActiveInsightKeys).mockResolvedValue([
      { key: 'budgetPreference', category: 'BUYING_SIGNAL', type: 'enum', options: ['lowest', 'balanced', 'best_coverage'] },
    ] as never)
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        insights: [{ key: 'budgetPreference', value: 'balanced', confidence: 0.9 }],
      }),
    } as never)

    await extractAndPersistInsights({
      message: 'caut ceva echilibrat',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: 'prod-1',
      mode: 'SALES',
      traceId: 't-1',
    })

    const args = vi.mocked(prisma.customerInsight.upsert).mock.calls[0][0]
    expect(args.create.productId).toBe('prod-1')
    expect(args.create.category).toBe('BUYING_SIGNAL')
  })

  it('does NOT stamp productId on global BUYING_SIGNAL keys', async () => {
    vi.mocked(getActiveInsightKeys).mockResolvedValue([
      { key: 'urgency', category: 'BUYING_SIGNAL', type: 'enum', options: ['immediate', 'weeks', 'exploring'] },
    ] as never)
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        insights: [{ key: 'urgency', value: 'immediate', confidence: 0.9 }],
      }),
    } as never)

    await extractAndPersistInsights({
      message: 'urgent',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: 'prod-1',
      mode: 'SALES',
      traceId: 't-1',
    })

    const args = vi.mocked(prisma.customerInsight.upsert).mock.calls[0][0]
    expect(args.create.productId).toBeNull()
  })

  it('defaults confidence to 0.7 when extractor omits it', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        insights: [{ key: 'age', value: 30 }],
      }),
    } as never)

    await extractAndPersistInsights({
      message: 'am 30',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: null,
      mode: 'SALES',
      traceId: 't-1',
    })

    const args = vi.mocked(prisma.customerInsight.upsert).mock.calls[0][0]
    expect(args.create.confidence).toBe(0.7)
  })

  it('runs in SALES mode without regex match', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ insights: [] }),
    } as never)

    await extractAndPersistInsights({
      message: 'salut',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: null,
      mode: 'SALES',
      traceId: 't-1',
    })

    expect(gateway.call).toHaveBeenCalledOnce()
  })

  it('skips non-SALES mode when regex does not match', async () => {
    await extractAndPersistInsights({
      message: 'salut',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: null,
      mode: 'ONBOARDING',
      traceId: 't-1',
    })

    expect(gateway.call).not.toHaveBeenCalled()
  })

  it('runs in non-SALES mode when regex matches personal info', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ insights: [] }),
    } as never)

    await extractAndPersistInsights({
      message: 'am 40 ani și doi copii',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: null,
      mode: 'ONBOARDING',
      traceId: 't-1',
    })

    expect(gateway.call).toHaveBeenCalledOnce()
  })
})
