/**
 * Self-Improvement Dashboard — ADMIN only
 *
 * Server component. Shows pipeline stats and controls.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { isBatchRunning } from '@/lib/self-improvement/batch-runner'
import SelfImprovementDashboard from '@/components/admin/self-improvement-dashboard'

export default async function SelfImprovementPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    totalScored,
    recentScores,
    proposalCounts,
    topSkillPacks,
    lowKnowledge,
    activeRegressions,
    simulationRuns,
    simulatedScores,
    realScores,
  ] = await Promise.all([
    prisma.conversationScore.count(),
    prisma.conversationScore.findMany({
      where: { scoredAt: { gte: sevenDaysAgo } },
      select: { score: true },
    }),
    prisma.improvementProposal.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.conversationScore.groupBy({
      by: ['skillPackSlugs'],
      _avg: { score: true },
      _count: { _all: true },
      orderBy: { _avg: { score: 'desc' } },
      take: 5,
    }),
    prisma.agentKnowledge.findMany({
      where: { isActive: true, sampleSize: { gte: 10 } },
      orderBy: { successRate: 'asc' },
      take: 5,
      select: { id: true, category: true, trigger: true, successRate: true, sampleSize: true },
    }),
    prisma.improvementProposal.findMany({
      where: { type: 'INSIGHT', status: 'PENDING', title: { startsWith: 'Regression' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    // Simulation runs (last 10)
    prisma.simulationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
    }),
    // Simulated scores (7d)
    prisma.conversationScore.findMany({
      where: {
        scoredAt: { gte: sevenDaysAgo },
        conversation: { channel: 'simulation' },
      },
      select: { score: true },
    }),
    // Real scores (7d)
    prisma.conversationScore.findMany({
      where: {
        scoredAt: { gte: sevenDaysAgo },
        conversation: { channel: { not: 'simulation' } },
      },
      select: { score: true },
    }),
  ])

  const avgScore7d = recentScores.length > 0
    ? recentScores.reduce((sum, s) => sum + s.score, 0) / recentScores.length
    : 0

  const proposals = { pending: 0, approved: 0, rejected: 0 }
  for (const g of proposalCounts) {
    proposals[g.status.toLowerCase() as 'pending' | 'approved' | 'rejected'] = g._count.id
  }

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Self-Improvement</h2>
      <SelfImprovementDashboard
        data={{
          totalScored,
          avgScore7d,
          scoreCount7d: recentScores.length,
          proposals,
          topSkillPacks,
          lowKnowledge,
          activeRegressions: activeRegressions.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            createdAt: r.createdAt.toISOString(),
          })),
          batchRunning: isBatchRunning(),
          simulationRuns: simulationRuns.map((r) => ({
            id: r.id,
            status: r.status,
            trigger: r.trigger,
            totalScenarios: r.totalScenarios,
            completedCount: r.completedCount,
            failedCount: r.failedCount,
            avgScore: r.avgScore,
            errors: r.errors as string[],
            startedAt: r.startedAt.toISOString(),
            completedAt: r.completedAt?.toISOString() ?? null,
          })),
          simulationRunning: false,
          simulatedAvg7d: simulatedScores.length > 0
            ? simulatedScores.reduce((s: number, x: { score: number }) => s + x.score, 0) / simulatedScores.length
            : null,
          simulatedCount7d: simulatedScores.length,
          realAvg7d: realScores.length > 0
            ? realScores.reduce((s: number, x: { score: number }) => s + x.score, 0) / realScores.length
            : null,
          realCount7d: realScores.length,
        }}
      />
    </div>
  )
}
