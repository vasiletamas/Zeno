/**
 * Shared types for the self-improvement pipeline.
 */

export interface ScoredConversation {
  conversationId: string
  quoteGenerated: boolean
  applicationSubmitted: boolean
  policyPurchased: boolean
  score: number
  messageCount: number
  totalCost: number
  totalLatencyMs: number
  anomalyCount: number
  mode: string
  skillPackSlugs: string[]
}

export interface AnalysisResult {
  /** Average score per skill pack slug combination (JSON key = sorted slugs joined by +) */
  skillPackPerformance: Record<string, { avgScore: number; count: number }>
  /** Patterns detected as free-text observations */
  patterns: string[]
  /** A/B test results keyed by test ID */
  abTestResults: Record<string, { avgScoreA: number; avgScoreB: number; countA: number; countB: number }>
  /** Top and bottom conversation IDs for proposer */
  topConversationIds: string[]
  bottomConversationIds: string[]
}

export interface ProposalDiff {
  /** For KNOWLEDGE_CREATE */
  create?: {
    category: string
    trigger: string
    content: string
    productId?: string
    workflowStepCode?: string
  }
  /** For KNOWLEDGE_UPDATE */
  update?: {
    knowledgeId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
  /** For INSIGHT */
  insight?: {
    observation: string
  }
}

export interface ProposalEvidence {
  conversationIds: string[]
  sampleSize: number
  confidence: number
}

export interface BatchResult {
  startedAt: Date
  completedAt: Date
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  scored: number
  analysisComplete: boolean
  proposalsGenerated: number
  regressionsDetected: number
  error?: string
}
