import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockScoreConversations = vi.fn()
const mockAnalyzeScores = vi.fn()
const mockGenerateProposals = vi.fn()
const mockTrackAdoptedProposals = vi.fn()

vi.mock('@/lib/self-improvement/scorer', () => ({
  scoreConversations: (...args: unknown[]) => mockScoreConversations(...args),
}))
vi.mock('@/lib/self-improvement/analyzer', () => ({
  analyzeScores: (...args: unknown[]) => mockAnalyzeScores(...args),
}))
vi.mock('@/lib/self-improvement/proposer', () => ({
  generateProposals: (...args: unknown[]) => mockGenerateProposals(...args),
}))
vi.mock('@/lib/self-improvement/tracker', () => ({
  trackAdoptedProposals: (...args: unknown[]) => mockTrackAdoptedProposals(...args),
}))

const { runDailyBatch } = await import('@/lib/self-improvement/batch-runner')

describe('runDailyBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs all 4 agents sequentially and returns SUCCESS', async () => {
    const analysis = { skillPackPerformance: {}, patterns: [], abTestResults: {}, topConversationIds: ['c1'], bottomConversationIds: ['c2'] }
    mockScoreConversations.mockResolvedValue(5)
    mockAnalyzeScores.mockResolvedValue(analysis)
    mockGenerateProposals.mockResolvedValue(2)
    mockTrackAdoptedProposals.mockResolvedValue(0)

    const result = await runDailyBatch()

    expect(result.status).toBe('SUCCESS')
    expect(result.scored).toBe(5)
    expect(result.analysisComplete).toBe(true)
    expect(result.proposalsGenerated).toBe(2)
    expect(result.regressionsDetected).toBe(0)
    expect(mockScoreConversations).toHaveBeenCalledBefore(mockAnalyzeScores)
    expect(mockAnalyzeScores).toHaveBeenCalledBefore(mockGenerateProposals)
    expect(mockGenerateProposals).toHaveBeenCalledBefore(mockTrackAdoptedProposals)
  })

  it('returns PARTIAL when analyzer fails but scorer succeeds', async () => {
    mockScoreConversations.mockResolvedValue(3)
    mockAnalyzeScores.mockRejectedValue(new Error('DB connection lost'))

    const result = await runDailyBatch()

    expect(result.status).toBe('PARTIAL')
    expect(result.scored).toBe(3)
    expect(result.analysisComplete).toBe(false)
    expect(result.proposalsGenerated).toBe(0)
    expect(result.error).toContain('DB connection lost')
    expect(mockGenerateProposals).not.toHaveBeenCalled()
  })

  it('returns FAILED when scorer fails', async () => {
    mockScoreConversations.mockRejectedValue(new Error('Scorer crashed'))

    const result = await runDailyBatch()

    expect(result.status).toBe('FAILED')
    expect(result.scored).toBe(0)
    expect(result.error).toContain('Scorer crashed')
    expect(mockAnalyzeScores).not.toHaveBeenCalled()
  })
})
