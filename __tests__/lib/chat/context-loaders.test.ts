import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    customerInsight: { findMany: vi.fn() },
    agentKnowledge: { findMany: vi.fn() },
  },
}))

const { prisma } = await import('@/lib/db')

const { loadCustomerMemory, loadAgentKnowledge } = await import('@/lib/chat/context-loaders')

describe('loadCustomerMemory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null when no insights exist', async () => {
    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([])
    const result = await loadCustomerMemory('cust-1')
    expect(result).toBeNull()
  })

  it('formats insights grouped by category', async () => {
    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([
      {
        id: '1', customerId: 'cust-1', category: 'PREFERENCE',
        key: 'price_sensitivity', value: 'High — mentioned budget concerns',
        confidence: 0.8, source: 'conv-1',
        lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      },
      {
        id: '2', customerId: 'cust-1', category: 'BUYING_SIGNAL',
        key: 'urgency', value: 'Expecting a child soon',
        confidence: 0.9, source: 'conv-1',
        lastConfirmedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      },
    ] as never)

    const result = await loadCustomerMemory('cust-1')
    expect(result).toContain('PREFERENCE')
    expect(result).toContain('price_sensitivity')
    expect(result).toContain('BUYING_SIGNAL')
    expect(result).toContain('urgency')
  })

  it('marks stale insights as unverified', async () => {
    const staleDate = new Date()
    staleDate.setDate(staleDate.getDate() - 45)

    vi.mocked(prisma.customerInsight.findMany).mockResolvedValue([
      {
        id: '1', customerId: 'cust-1', category: 'DEMOGRAPHIC',
        key: 'occupation', value: 'Software engineer',
        confidence: 0.7, source: 'conv-old',
        lastConfirmedAt: staleDate, createdAt: staleDate, updatedAt: staleDate,
      },
    ] as never)

    const result = await loadCustomerMemory('cust-1')
    expect(result).toContain('unverified')
  })
})

describe('loadAgentKnowledge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns null when no knowledge exists', async () => {
    vi.mocked(prisma.agentKnowledge.findMany).mockResolvedValue([])
    const result = await loadAgentKnowledge(null, null)
    expect(result).toBeNull()
  })

  it('formats knowledge with success rates', async () => {
    vi.mocked(prisma.agentKnowledge.findMany).mockResolvedValue([
      {
        id: '1', category: 'OBJECTION_RESPONSE',
        trigger: 'price_objection', content: 'Focus on value per day calculation',
        successRate: 0.75, sampleSize: 20, productId: 'prod-1',
        workflowStepCode: null, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      },
    ] as never)

    const result = await loadAgentKnowledge('prod-1', null)
    expect(result).toContain('price_objection')
    expect(result).toContain('75%')
    expect(result).toContain('n=20')
  })
})
