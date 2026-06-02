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
