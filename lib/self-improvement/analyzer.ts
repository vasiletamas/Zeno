/**
 * Analyzer Agent — aggregates conversation scores, updates knowledge
 * effectiveness, detects patterns, and computes A/B test results.
 */

import { prisma } from '@/lib/db'
import type { AnalysisResult } from './types'

const TOP_N = 5
const BOTTOM_N = 5

export async function analyzeScores(): Promise<AnalysisResult> {
  // Fetch scores from the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const scores = await prisma.conversationScore.findMany({
    where: { scoredAt: { gte: since } },
    orderBy: { score: 'desc' },
  })

  if (scores.length === 0) {
    return {
      skillPackPerformance: {},
      patterns: [],
      abTestResults: {},
      topConversationIds: [],
      bottomConversationIds: [],
    }
  }

  // Sort scores descending by score (in case DB didn't sort)
  const sorted = [...scores].sort((a, b) => b.score - a.score)

  // 1. Skill pack performance — group by sorted slug combination
  const skillPackPerformance: Record<string, { avgScore: number; count: number }> = {}
  for (const s of sorted) {
    const key = [...s.skillPackSlugs].sort().join('+') || '(none)'
    const entry = skillPackPerformance[key] ?? { avgScore: 0, count: 0 }
    entry.avgScore = (entry.avgScore * entry.count + s.score) / (entry.count + 1)
    entry.count++
    skillPackPerformance[key] = entry
  }

  // 2. Top and bottom conversations
  const topConversationIds = sorted.slice(0, TOP_N).map((s) => s.conversationId)
  const bottomConversationIds = sorted
    .slice(-BOTTOM_N)
    .reverse()
    .map((s) => s.conversationId)

  // 3. Update AgentKnowledge successRates
  const knowledgeEntries = await prisma.agentKnowledge.findMany({
    where: { isActive: true },
  })

  for (const knowledge of knowledgeEntries) {
    // Match scores by product/mode context
    const matchingScores = sorted.filter((s) => {
      if (knowledge.productId && knowledge.workflowStepCode) {
        return s.mode === 'SALES' // broad match for product-specific knowledge
      }
      return true // general knowledge matches all
    })

    if (matchingScores.length === 0) continue

    const newAvgScore =
      matchingScores.reduce((sum, s) => sum + s.score, 0) / matchingScores.length
    const newSampleSize = knowledge.sampleSize + matchingScores.length

    // Weighted moving average
    const weightedRate =
      (knowledge.successRate * knowledge.sampleSize + newAvgScore * matchingScores.length) /
      newSampleSize

    await prisma.agentKnowledge.update({
      where: { id: knowledge.id },
      data: {
        successRate: weightedRate,
        sampleSize: newSampleSize,
      },
    })
  }

  // 4. Pattern detection
  const patterns: string[] = []

  // Only detect message-count patterns when the field is present
  const scoresWithMessages = sorted.filter(
    (s) => typeof s.messageCount === 'number' && s.messageCount > 0,
  )
  if (scoresWithMessages.length > 1) {
    const avgMessages =
      scoresWithMessages.reduce((sum, s) => sum + s.messageCount, 0) /
      scoresWithMessages.length

    const shortConvs = scoresWithMessages.filter((s) => s.messageCount <= avgMessages)
    const longConvs = scoresWithMessages.filter((s) => s.messageCount > avgMessages)
    if (shortConvs.length > 0 && longConvs.length > 0) {
      const shortAvg = shortConvs.reduce((sum, s) => sum + s.score, 0) / shortConvs.length
      const longAvg = longConvs.reduce((sum, s) => sum + s.score, 0) / longConvs.length
      if (longAvg > 0 && shortAvg > longAvg * 1.2) {
        patterns.push(
          `Shorter conversations (≤${Math.round(avgMessages)} messages) score ${Math.round((shortAvg / longAvg - 1) * 100)}% higher than longer ones.`,
        )
      }
    }
  }

  // Task 5.5 (D12): surface quality regressions — the loop is no longer
  // blind to re-asks, unexplained errors, rejected insights, or dead
  // verification funnels.
  const q = sorted.reduce(
    (acc, s) => ({
      reasked: acc.reasked + (s.reaskedKnownFactCount ?? 0),
      errors: acc.errors + (s.unexplainedToolErrorCount ?? 0),
      rejected: acc.rejected + (s.insightRejectedCount ?? 0),
      verified: acc.verified + (s.verificationCompleted ? 1 : 0),
    }),
    { reasked: 0, errors: 0, rejected: 0, verified: 0 },
  )
  if (q.reasked > 0) patterns.push(`${q.reasked} known-fact re-ask(s) across ${sorted.length} conversation(s) — stored facts are not being consulted.`)
  if (q.errors > 0) patterns.push(`${q.errors} unexplained tool error(s) (failed and never recovered) across ${sorted.length} conversation(s).`)
  if (q.rejected > 0) patterns.push(`${q.rejected} insight emission(s) rejected by the typed gate — extractor quality regression.`)
  if (q.verified < sorted.length) patterns.push(`Channel verification completed in only ${q.verified}/${sorted.length} scored conversation(s).`)

  // A/B test results died with the pack A/B machinery (A5.2).

  return {
    skillPackPerformance,
    patterns,
    abTestResults: {}, // pack A/B machinery deleted (A5.2)
    topConversationIds,
    bottomConversationIds,
  }
}
