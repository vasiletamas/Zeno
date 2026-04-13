import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockProposalFindMany = vi.fn()
const mockProposalCreate = vi.fn()
const mockScoreAggregate = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    improvementProposal: {
      findMany: (...args: unknown[]) => mockProposalFindMany(...args),
      create: (...args: unknown[]) => mockProposalCreate(...args),
    },
    conversationScore: {
      aggregate: (...args: unknown[]) => mockScoreAggregate(...args),
      count: vi.fn().mockResolvedValue(50),
    },
  },
}))

vi.mock('@/lib/errors/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

const { trackAdoptedProposals } = await import('@/lib/self-improvement/tracker')

describe('trackAdoptedProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects regression when score drops >10%', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: 'p1',
        type: 'KNOWLEDGE_UPDATE',
        title: 'Updated objection response',
        appliedAt: new Date('2026-04-01'),
        baselineMetrics: { avgScore: 0.7, sampleSize: 20 },
        diff: { update: { knowledgeId: 'k1' } },
      },
    ])
    // Post-adoption average is 0.5 — a >10% drop from 0.7
    mockScoreAggregate.mockResolvedValue({ _avg: { score: 0.5 }, _count: { score: 40 } })
    mockProposalCreate.mockResolvedValue({ id: 'p-regression' })

    const result = await trackAdoptedProposals()

    expect(result).toBe(1)
    expect(mockProposalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'INSIGHT',
        title: expect.stringContaining('Regression'),
        status: 'PENDING',
      }),
    })
  })

  it('skips proposals with insufficient post-adoption data', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: 'p2',
        type: 'SKILLPACK_UPDATE',
        title: 'Updated discovery pack',
        appliedAt: new Date(),
        baselineMetrics: { avgScore: 0.6, sampleSize: 15 },
        diff: { skillPackUpdate: { skillPackSlug: 'discovery' } },
      },
    ])
    // Only 10 conversations since adoption — below 30 threshold
    mockScoreAggregate.mockResolvedValue({ _avg: { score: 0.3 }, _count: { score: 10 } })

    const result = await trackAdoptedProposals()

    expect(result).toBe(0)
    expect(mockProposalCreate).not.toHaveBeenCalled()
  })

  it('does not flag when score is stable', async () => {
    mockProposalFindMany.mockResolvedValue([
      {
        id: 'p3',
        type: 'KNOWLEDGE_CREATE',
        title: 'New pattern',
        appliedAt: new Date('2026-04-01'),
        baselineMetrics: { avgScore: 0.6, sampleSize: 20 },
        diff: { create: { category: 'OBJECTION_RESPONSE', trigger: 'x', content: 'y' } },
      },
    ])
    // Score is 0.58 — only ~3% drop, within 10% threshold
    mockScoreAggregate.mockResolvedValue({ _avg: { score: 0.58 }, _count: { score: 35 } })

    const result = await trackAdoptedProposals()

    expect(result).toBe(0)
    expect(mockProposalCreate).not.toHaveBeenCalled()
  })

  it('returns 0 when no approved proposals exist', async () => {
    mockProposalFindMany.mockResolvedValue([])

    const result = await trackAdoptedProposals()

    expect(result).toBe(0)
  })
})
