/**
 * GET /api/admin/self-improvement — dashboard stats
 * POST /api/admin/self-improvement — trigger batch run
 *
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { runDailyBatch, isBatchRunning } from '@/lib/self-improvement/batch-runner'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [
      totalScored,
      recentScores,
      proposalCounts,
      topSkillPacks,
      lowKnowledge,
      activeRegressions,
    ] = await Promise.all([
      prisma.conversationScore.count(),
      prisma.conversationScore.findMany({
        where: { scoredAt: { gte: sevenDaysAgo } },
        select: { score: true, scoredAt: true },
        orderBy: { scoredAt: 'asc' },
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
        where: {
          type: 'INSIGHT',
          status: 'PENDING',
          title: { startsWith: 'Regression' },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ])

    const avgScore7d = recentScores.length > 0
      ? recentScores.reduce((sum, s) => sum + s.score, 0) / recentScores.length
      : 0

    const proposals = { pending: 0, approved: 0, rejected: 0 }
    for (const g of proposalCounts) {
      proposals[g.status.toLowerCase() as 'pending' | 'approved' | 'rejected'] = g._count.id
    }

    return NextResponse.json({
      totalScored,
      avgScore7d,
      scoreCount7d: recentScores.length,
      proposals,
      topSkillPacks,
      lowKnowledge,
      activeRegressions,
      batchRunning: isBatchRunning(),
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (isBatchRunning()) {
      return NextResponse.json({ error: 'Batch is already running' }, { status: 409 })
    }

    const batchPromise = runDailyBatch()
    batchPromise.catch(() => {})

    return NextResponse.json({ message: 'Batch started' }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
