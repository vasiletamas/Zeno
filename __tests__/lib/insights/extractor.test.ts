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

  it('persists preference insights: "vreau varianta Standard, ceva ieftin" → preferredTier + budgetSensitivity (Task 3.1, D3)', async () => {
    vi.mocked(getActiveInsightKeys).mockResolvedValue([
      { key: 'preferredTier', category: 'PREFERENCE', type: 'enum', options: ['standard', 'optim'] },
      { key: 'budgetSensitivity', category: 'PREFERENCE', type: 'enum', options: ['low', 'medium', 'high'] },
    ] as never)
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({
        insights: [
          { key: 'preferredTier', value: 'standard', confidence: 0.9 },
          { key: 'budgetSensitivity', value: 'high', confidence: 0.8 },
        ],
      }),
    } as never)

    await extractAndPersistInsights({
      message: 'vreau varianta Standard, ceva ieftin',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: 'prod-1',
      mode: 'SALES',
      traceId: 't-1',
    })

    expect(prisma.customerInsight.upsert).toHaveBeenCalledTimes(2)
    const keys = vi.mocked(prisma.customerInsight.upsert).mock.calls.map((c) => c[0].create.key)
    expect(keys).toEqual(expect.arrayContaining(['preferredTier', 'budgetSensitivity']))
    for (const c of vi.mocked(prisma.customerInsight.upsert).mock.calls) {
      expect(c[0].create.category).toBe('PREFERENCE')
    }
  })

  it('persists NO preference rows when the message carries none', async () => {
    vi.mocked(getActiveInsightKeys).mockResolvedValue([
      { key: 'preferredTier', category: 'PREFERENCE', type: 'enum', options: ['standard', 'optim'] },
    ] as never)
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ insights: [] }),
    } as never)

    await extractAndPersistInsights({
      message: 'buna, ce mai faci?',
      customerId: 'cust-1',
      conversationId: 'conv-1',
      productId: 'prod-1',
      mode: 'SALES',
      traceId: 't-1',
    })

    expect(prisma.customerInsight.upsert).not.toHaveBeenCalled()
  })

  // Task 3.2 (D4): typed validation BEFORE persistence — the age=0 class.
  it('rejects age=0 from extractor response', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ insights: [{ key: 'age', value: 0, confidence: 0.9 }] }),
    } as never)
    await extractAndPersistInsights({
      message: 'x', customerId: 'cust-1', conversationId: 'conv-1', productId: null, mode: 'SALES', traceId: 't-1',
    })
    expect(prisma.customerInsight.upsert).not.toHaveBeenCalled()
    expect(logWarn).toHaveBeenCalledWith(expect.objectContaining({ category: 'insight_rejected' }))
  })

  it('rejects familySize=-1, out-of-options enums, and boolean "yes"; valid age=40 persists', async () => {
    vi.mocked(getActiveInsightKeys).mockResolvedValue([
      { key: 'age', category: 'DEMOGRAPHIC', type: 'number' },
      { key: 'familySize', category: 'DEMOGRAPHIC', type: 'number' },
      { key: 'budgetSensitivity', category: 'PREFERENCE', type: 'enum', options: ['low', 'medium', 'high'] },
      { key: 'hasChildren', category: 'DEMOGRAPHIC', type: 'boolean' },
    ] as never)
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ insights: [
        { key: 'familySize', value: -1, confidence: 0.9 },
        { key: 'budgetSensitivity', value: 'super_cheap', confidence: 0.9 },
        { key: 'hasChildren', value: 'yes', confidence: 0.9 },
        { key: 'age', value: 40, confidence: 0.9 },
      ] }),
    } as never)
    await extractAndPersistInsights({
      message: 'x', customerId: 'cust-1', conversationId: 'conv-1', productId: null, mode: 'SALES', traceId: 't-1',
    })
    expect(prisma.customerInsight.upsert).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.customerInsight.upsert).mock.calls[0][0].create).toMatchObject({ key: 'age', value: '40' })
    const rejected = vi.mocked(logWarn).mock.calls.filter((c) => (c[0] as { category?: string }).category === 'insight_rejected')
    expect(rejected).toHaveLength(3)
  })

  it('age above 120 is a placeholder/typo — rejected', async () => {
    vi.mocked(gateway.call).mockResolvedValue({
      content: JSON.stringify({ insights: [{ key: 'age', value: 300, confidence: 0.9 }] }),
    } as never)
    await extractAndPersistInsights({
      message: 'x', customerId: 'cust-1', conversationId: 'conv-1', productId: null, mode: 'SALES', traceId: 't-1',
    })
    expect(prisma.customerInsight.upsert).not.toHaveBeenCalled()
  })

  it('the extractor prompt forbids placeholder emissions (omit when not stated)', async () => {
    vi.mocked(gateway.call).mockResolvedValue({ content: JSON.stringify({ insights: [] }) } as never)
    await extractAndPersistInsights({
      message: 'am 40 de ani', customerId: 'cust-1', conversationId: 'conv-1', productId: null, mode: 'SALES', traceId: 't-1',
    })
    const prompt = vi.mocked(gateway.call).mock.calls[0][1].overrideSystemPrompt as string
    expect(prompt).toMatch(/omit .*fact entirely/i)
    expect(prompt).toMatch(/never emit 0|placeholder/i)
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
