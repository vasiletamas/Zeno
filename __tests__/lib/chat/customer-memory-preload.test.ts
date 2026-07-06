import { describe, it, expect, vi } from 'vitest'

const findManySpy = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: {
      findMany: (...args: unknown[]) => findManySpy(...args),
    },
  },
}))

const { loadCustomerMemory, loadCustomerInsights } = await import('@/lib/chat/context-loaders')

const sampleInsight = {
  id: 'i1',
  customerId: 'c1',
  productId: null,
  category: 'PREFERENCE',
  key: 'language',
  value: 'ro',
  confidence: 0.9,
  source: 'conv-1',
  lastConfirmedAt: new Date('2026-05-20T12:00:00Z'),
  createdAt: new Date('2026-05-20T12:00:00Z'),
  updatedAt: new Date('2026-05-20T12:00:00Z'),
} as const

describe('loadCustomerMemory — preloaded insights', () => {
  it('uses preloaded insights and does not query the DB', async () => {
    findManySpy.mockClear()
    const text = await loadCustomerMemory('c1', [sampleInsight])
    expect(findManySpy).not.toHaveBeenCalled()
    expect(text).toContain('language: ro')
    expect(text).toContain('PREFERENCE:')
  })

  it('falls back to querying when no preloaded insights are passed', async () => {
    findManySpy.mockClear()
    findManySpy.mockResolvedValueOnce([sampleInsight])
    const text = await loadCustomerMemory('c1')
    expect(findManySpy).toHaveBeenCalledTimes(1)
    expect(text).toContain('language: ro')
  })

  it('returns null when preloaded insights is an empty array', async () => {
    findManySpy.mockClear()
    const text = await loadCustomerMemory('c1', [])
    expect(findManySpy).not.toHaveBeenCalled()
    expect(text).toBeNull()
  })
})

describe('loadCustomerMemory — PREFERENCE-first ordering under the token cap (Task 3.3, D3)', () => {
  const mk = (over: Record<string, unknown> & { id: string; key: string }) => ({ ...sampleInsight, ...over })

  it('renders PREFERENCE before other categories regardless of confidence order', async () => {
    const rows = [
      mk({ id: 'a', key: 'age', category: 'DEMOGRAPHIC', value: '40', confidence: 0.99 }),
      mk({ id: 'b', key: 'preferredTier', category: 'PREFERENCE', value: 'optim', confidence: 0.8 }),
      mk({ id: 'c', key: 'smokingStatus', category: 'RISK_FACTOR', value: 'non_smoker', confidence: 0.95 }),
    ]
    const text = await loadCustomerMemory('c1', rows as never)
    const prefIdx = text!.indexOf('PREFERENCE:')
    const riskIdx = text!.indexOf('RISK_FACTOR:')
    const demoIdx = text!.indexOf('DEMOGRAPHIC:')
    expect(prefIdx).toBeGreaterThanOrEqual(0)
    expect(prefIdx).toBeLessThan(riskIdx)
    expect(riskIdx).toBeLessThan(demoIdx)
  })

  it('truncation under the token cap drops the tail, never the PREFERENCE head', async () => {
    const rows = [
      mk({ id: 'p1', key: 'preferredTier', category: 'PREFERENCE', value: 'optim' }),
      ...Array.from({ length: 80 }, (_, i) =>
        mk({ id: `d${i}`, key: `someLongDetailKey${i}`, category: 'DEMOGRAPHIC', value: `a-rather-long-descriptive-value-${i}` })),
    ]
    const text = await loadCustomerMemory('c1', rows as never)
    expect(text).toContain('preferredTier: optim')
  })
})

describe('loadCustomerInsights', () => {
  it('returns raw rows from prisma.customerInsight.findMany', async () => {
    findManySpy.mockClear()
    findManySpy.mockResolvedValueOnce([sampleInsight])
    const rows = await loadCustomerInsights('c1')
    expect(rows).toEqual([sampleInsight])
    expect(findManySpy).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
    })
  })
})
