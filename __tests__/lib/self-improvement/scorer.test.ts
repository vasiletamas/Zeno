import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Prisma
const mockFindMany = vi.fn()
const mockCreate = vi.fn()
// B4: the scorer resolves the application via the activeApplicationId pointer
const mockAppFindUnique = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversation: { findMany: (...args: unknown[]) => mockFindMany(...args) },
    conversationScore: { create: (...args: unknown[]) => mockCreate(...args) },
    application: { findUnique: (...args: unknown[]) => mockAppFindUnique(...args) },
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
        activeApplicationId: 'app-1',
        turnTraces: [
          { cost: 0.05, latencyMs: 2000, anomalies: [], inputTokens: 4000, cacheReadTokens: 3000, cacheWriteTokens: 0 },
          { cost: 0.03, latencyMs: 1500, anomalies: [{ type: 'latency' }], inputTokens: 5000, cacheReadTokens: 0, cacheWriteTokens: 3500 },
        ],
      },
    ])
    // D2 (contradiction #3): purchase truth = a PAID installment on the
    // quote's schedule, never Payment→Policy
    mockAppFindUnique.mockResolvedValue({
      id: 'app-1',
      quote: {
        id: 'quote-1',
        paymentSchedules: [{ installments: [{ id: 'inst-1' }] }],
      },
    })
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
        skillPackSlugs: [], // pack subsystem deleted (A5.2)
        // A1c cache aggregates: 1 of 2 LLM turns read from cache
        totalPromptTokens: 9000,
        totalCachedTokens: 3000,
        avgCacheHitRate: 0.5,
      }),
    })
  })

  it('A1c: avgCacheHitRate is null when no trace carries token telemetry', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-old',
        messageCount: 4,
        mode: 'SALES',
        activeApplicationId: null,
        // pre-A1 rows: no inputTokens/cache fields persisted
        turnTraces: [{ cost: 0.01, latencyMs: 900, anomalies: [] }],
      },
    ])
    mockCreate.mockResolvedValue({ id: 'score-old' })

    await scoreConversations()

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        totalPromptTokens: 0,
        totalCachedTokens: 0,
        avgCacheHitRate: null,
      }),
    })
  })

  it('scores a conversation with only quote as ~0.4737', async () => {
    mockFindMany.mockResolvedValue([
      {
        id: 'conv-2',
        messageCount: 8,
        mode: 'SALES',
        activeApplicationId: 'app-2',
        turnTraces: [{ cost: 0.02, latencyMs: 1000, anomalies: [] }],
      },
    ])
    mockAppFindUnique.mockResolvedValue({
      id: 'app-2',
      quote: { id: 'quote-2', paymentSchedules: [] },
    })
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
        activeApplicationId: null,
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
