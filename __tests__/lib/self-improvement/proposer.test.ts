import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AnalysisResult } from '@/lib/self-improvement/types'

const mockGatewayCall = vi.fn()
const mockMessageFindMany = vi.fn()
const mockProposalCreate = vi.fn()
const mockKnowledgeFindMany = vi.fn()
const mockSkillPackFindMany = vi.fn()

vi.mock('@/lib/llm/gateway', () => ({
  gateway: { call: (...args: unknown[]) => mockGatewayCall(...args) },
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    message: { findMany: (...args: unknown[]) => mockMessageFindMany(...args) },
    improvementProposal: { create: (...args: unknown[]) => mockProposalCreate(...args) },
    agentKnowledge: { findMany: (...args: unknown[]) => mockKnowledgeFindMany(...args) },
    skillPack: { findMany: (...args: unknown[]) => mockSkillPackFindMany(...args) },
  },
}))

vi.mock('@/lib/errors/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}))

const { generateProposals } = await import('@/lib/self-improvement/proposer')

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    skillPackPerformance: { discovery: { avgScore: 0.6, count: 10 } },
    patterns: ['Short conversations convert better'],
    abTestResults: {},
    topConversationIds: ['c1', 'c2'],
    bottomConversationIds: ['c3', 'c4'],
    ...overrides,
  }
}

describe('generateProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockKnowledgeFindMany.mockResolvedValue([])
    mockSkillPackFindMany.mockResolvedValue([])
    mockMessageFindMany.mockResolvedValue([
      { role: 'user', content: 'Hello', conversationId: 'c1' },
      { role: 'assistant', content: 'Hi there', conversationId: 'c1' },
    ])
  })

  it('creates proposals from valid LLM response', async () => {
    const llmResponse = {
      content: JSON.stringify({
        proposals: [
          {
            type: 'KNOWLEDGE_CREATE',
            title: 'New objection response for price concern',
            description: 'Customers respond well to daily cost comparison',
            diff: { create: { category: 'OBJECTION_RESPONSE', trigger: 'too expensive', content: 'Compare to daily coffee cost' } },
            confidence: 0.8,
          },
        ],
      }),
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    }
    mockGatewayCall.mockResolvedValue(llmResponse)
    mockProposalCreate.mockResolvedValue({ id: 'p1' })

    const result = await generateProposals(makeAnalysis())

    expect(result).toBe(1)
    expect(mockProposalCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'KNOWLEDGE_CREATE',
        title: 'New objection response for price concern',
        status: 'PENDING',
      }),
    })
  })

  it('creates zero proposals when LLM returns malformed JSON', async () => {
    mockGatewayCall.mockResolvedValue({
      content: 'This is not valid JSON at all',
      usage: { promptTokens: 500, completionTokens: 50, totalTokens: 550 },
    })

    const result = await generateProposals(makeAnalysis())

    expect(result).toBe(0)
    expect(mockProposalCreate).not.toHaveBeenCalled()
  })

  it('skips proposals with missing required fields', async () => {
    const llmResponse = {
      content: JSON.stringify({
        proposals: [
          { type: 'KNOWLEDGE_CREATE', title: 'Good proposal', description: 'Valid', diff: { create: { category: 'OBJECTION_RESPONSE', trigger: 'x', content: 'y' } }, confidence: 0.8 },
          { type: 'INSIGHT', description: 'Missing title field', diff: {}, confidence: 0.5 },
        ],
      }),
      usage: { promptTokens: 500, completionTokens: 200, totalTokens: 700 },
    }
    mockGatewayCall.mockResolvedValue(llmResponse)
    mockProposalCreate.mockResolvedValue({ id: 'p1' })

    const result = await generateProposals(makeAnalysis())

    expect(result).toBe(1) // only the valid one
  })

  it('skips entirely when no conversations to analyze', async () => {
    const analysis = makeAnalysis({ topConversationIds: [], bottomConversationIds: [] })

    const result = await generateProposals(analysis)

    expect(result).toBe(0)
    expect(mockGatewayCall).not.toHaveBeenCalled()
  })
})
