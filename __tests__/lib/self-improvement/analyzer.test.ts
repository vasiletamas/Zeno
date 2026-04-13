import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScoreFindMany = vi.fn()
const mockKnowledgeFindMany = vi.fn()
const mockKnowledgeUpdate = vi.fn()
const mockAbTestFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    conversationScore: { findMany: (...args: unknown[]) => mockScoreFindMany(...args) },
    agentKnowledge: {
      findMany: (...args: unknown[]) => mockKnowledgeFindMany(...args),
      update: (...args: unknown[]) => mockKnowledgeUpdate(...args),
    },
    aBTestVariant: { findMany: (...args: unknown[]) => mockAbTestFindMany(...args) },
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

const { analyzeScores } = await import('@/lib/self-improvement/analyzer')

describe('analyzeScores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAbTestFindMany.mockResolvedValue([])
  })

  it('groups scores by skill pack combination', async () => {
    mockScoreFindMany.mockResolvedValue([
      { id: 's1', conversationId: 'c1', score: 0.8, skillPackSlugs: ['discovery', 'closing'], mode: 'SALES' },
      { id: 's2', conversationId: 'c2', score: 0.6, skillPackSlugs: ['discovery', 'closing'], mode: 'SALES' },
      { id: 's3', conversationId: 'c3', score: 0.2, skillPackSlugs: ['discovery'], mode: 'SALES' },
    ])
    mockKnowledgeFindMany.mockResolvedValue([])

    const result = await analyzeScores()

    expect(result.skillPackPerformance['closing+discovery']).toEqual({
      avgScore: 0.7,
      count: 2,
    })
    expect(result.skillPackPerformance['discovery']).toEqual({
      avgScore: 0.2,
      count: 1,
    })
  })

  it('identifies top and bottom conversations', async () => {
    const scores = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      conversationId: `c${i}`,
      score: i * 0.09,
      skillPackSlugs: [],
      mode: 'SALES',
    }))
    mockScoreFindMany.mockResolvedValue(scores)
    mockKnowledgeFindMany.mockResolvedValue([])

    const result = await analyzeScores()

    // Bottom 5 = c0..c4 (lowest scores), top 5 = c11..c7 (highest scores)
    expect(result.bottomConversationIds).toHaveLength(5)
    expect(result.topConversationIds).toHaveLength(5)
    expect(result.topConversationIds[0]).toBe('c11')
    expect(result.bottomConversationIds[0]).toBe('c0')
  })

  it('updates AgentKnowledge successRate with weighted moving average', async () => {
    mockScoreFindMany.mockResolvedValue([
      { id: 's1', conversationId: 'c1', score: 0.9, skillPackSlugs: [], mode: 'SALES' },
      { id: 's2', conversationId: 'c2', score: 0.7, skillPackSlugs: [], mode: 'SALES' },
    ])
    mockKnowledgeFindMany.mockResolvedValue([
      {
        id: 'k1',
        category: 'OBJECTION_RESPONSE',
        productId: null,
        workflowStepCode: null,
        successRate: 0.5,
        sampleSize: 10,
      },
    ])
    mockKnowledgeUpdate.mockResolvedValue({})

    await analyzeScores()

    expect(mockKnowledgeUpdate).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: {
        successRate: expect.any(Number),
        sampleSize: 12, // 10 + 2 new
      },
    })

    // Weighted moving average: (0.5 * 10 + 0.8 * 2) / 12 = 6.6 / 12 = 0.55
    const updateCall = mockKnowledgeUpdate.mock.calls[0][0]
    expect(updateCall.data.successRate).toBeCloseTo(0.55, 2)
  })

  it('returns empty analysis when no scores exist', async () => {
    mockScoreFindMany.mockResolvedValue([])
    mockKnowledgeFindMany.mockResolvedValue([])

    const result = await analyzeScores()

    expect(result.skillPackPerformance).toEqual({})
    expect(result.topConversationIds).toEqual([])
    expect(result.bottomConversationIds).toEqual([])
    expect(result.patterns).toEqual([])
  })
})
