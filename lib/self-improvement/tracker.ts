/**
 * Tracker Agent — monitors adopted proposals for performance regressions.
 *
 * For each approved + applied proposal, compares post-adoption average score
 * against baseline. Flags regressions (>10% drop) as INSIGHT proposals.
 */

import { prisma } from '@/lib/db'
import { logInfo } from '@/lib/errors/logger'

const MIN_POST_ADOPTION_CONVERSATIONS = 30
const REGRESSION_THRESHOLD = 0.10 // 10% drop

export async function trackAdoptedProposals(): Promise<number> {
  const adoptedProposals = await prisma.improvementProposal.findMany({
    where: {
      status: 'APPROVED',
      appliedAt: { not: null },
      baselineMetrics: { not: null },
    },
  })

  if (adoptedProposals.length === 0) return 0

  let regressions = 0

  for (const proposal of adoptedProposals) {
    const baseline = proposal.baselineMetrics as {
      avgScore: number
      sampleSize: number
    }
    if (!baseline?.avgScore) continue

    // Get post-adoption score aggregate
    const postAdoption = await prisma.conversationScore.aggregate({
      where: {
        scoredAt: { gte: proposal.appliedAt! },
      },
      _avg: { score: true },
      _count: { score: true },
    })

    const postCount = postAdoption._count.score
    const postAvg = postAdoption._avg.score

    // Skip if insufficient data
    if (postCount < MIN_POST_ADOPTION_CONVERSATIONS) continue
    if (postAvg === null) continue

    // Check for regression
    const dropPct = (baseline.avgScore - postAvg) / baseline.avgScore
    if (dropPct > REGRESSION_THRESHOLD) {
      await prisma.improvementProposal.create({
        data: {
          type: 'INSIGHT',
          title: `Regression detected: "${proposal.title}"`,
          description:
            `Score dropped ${Math.round(dropPct * 100)}% after adopting "${proposal.title}" ` +
            `(baseline: ${baseline.avgScore.toFixed(3)}, current: ${postAvg.toFixed(3)}, ` +
            `sample: ${postCount} conversations). Consider reverting this change.`,
          diff: { insight: { observation: `Regression from proposal ${proposal.id}` } },
          evidence: {
            conversationIds: [],
            sampleSize: postCount,
            confidence: Math.min(postCount / 100, 1.0),
          },
          status: 'PENDING',
        },
      })
      regressions++
    }
  }

  logInfo({
    layer: 'self-improvement',
    category: 'tracker',
    message: `Tracked ${adoptedProposals.length} proposals, found ${regressions} regressions`,
  })

  return regressions
}
