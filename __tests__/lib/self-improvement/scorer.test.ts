import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
const mockFindMany = vi.fn()
const mockCreate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    conversationScore: { create: (...args: unknown[]) => mockCreate(...args) },
  },
}))

const { scoreConversations } = await import('@/lib/self-improvement/scorer')

describe('scoreConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scores a conversation with quote + application + purchase as 1.0', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-1',
        messageCount: 12,
        mode: 'SALES',
        activeSkillPacks: ['life-insurance-discovery'],
        application: {
          id: 'app-1',
          quote: {
            id: 'quote-1',
            policy: {
              id: 'policy-1',
              payments: [{ status: 'COMPLETED' }],
            },
          },
        },
        turnTraces: [
          { cost: 0.05, latencyMs: 2000, anomalies: [] },
          { cost: 0.03, latencyMs: 1500, anomalies: [{ type: 'latency' }] },
        ],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-1' })

    const result = await scoreConversations()

    expect(result).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-1',
        quoteGenerated: true,
        applicationSubmitted: true,
        policyPurchased: true,
        score: 1.0, // (0.3 + 0.6 + 1.0) / 1.9 = 1.0
        messageCount: 12,
        totalCost: 0.08,
        totalLatencyMs: 3500,
        anomalyCount: 1,
        mode: 'SALES',
        skillPackSlugs: ['life-insurance-discovery'],
      }),
    })
  })

  it('scores a conversation with only quote as ~0.4737', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-2',
        messageCount: 8,
        mode: 'SALES',
        activeSkillPacks: [],
        application: {
          id: 'app-2',
          quote: { id: 'quote-2', policy: null },
        },
        turnTraces: [{ cost: 0.02, latencyMs: 1000, anomalies: [] }],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-2' })

    const result = await scoreConversations()

    expect(result).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: 'conv-2',
        quoteGenerated: true,
        applicationSubmitted: true,
        policyPurchased: false,
        score: expect.closeTo(0.4737, 3), // (0.3 + 0.6) / 1.9
      }),
    })
  })

  it('scores an abandoned conversation with no progress as 0', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-3',
        messageCount: 3,
        mode: 'SALES',
        activeSkillPacks: [],
        application: null,
        turnTraces: [{ cost: 0.01, latencyMs: 500, anomalies: [] }],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-3' })

    const result = await scoreConversations()

    expect(result).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quoteGenerated: false,
        applicationSubmitted: false,
        policyPurchased: false,
        score: 0,
      }),
    })
  })

  it('returns 0 when no unscored conversations exist', async () => {
    mockFindMany.mockResolvedValue([])

    const result = await scoreConversations()

    expect(result).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
