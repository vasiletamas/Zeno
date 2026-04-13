/**
 * GET /api/admin/ab-tests/:id/results
 *
 * Get A/B test results with score comparison.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const test = await prisma.aBTestVariant.findUnique({ where: { id } })
    if (!test) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [variantA, variantB] = await Promise.all([
      prisma.conversationScore.aggregate({
        where: {
          skillPackSlugs: { has: test.skillPackSlugA },
          scoredAt: { gte: test.startedAt },
        },
        _avg: { score: true },
        _count: { score: true },
      }),
      prisma.conversationScore.aggregate({
        where: {
          skillPackSlugs: { has: test.skillPackSlugB },
          scoredAt: { gte: test.startedAt },
        },
        _avg: { score: true },
        _count: { score: true },
      }),
    ])

    const minSample = 30
    const hasEnoughData = variantA._count.score >= minSample && variantB._count.score >= minSample

    return NextResponse.json({
      test,
      results: {
        variantA: {
          slug: test.skillPackSlugA,
          avgScore: variantA._avg.score ?? 0,
          count: variantA._count.score,
        },
        variantB: {
          slug: test.skillPackSlugB,
          avgScore: variantB._avg.score ?? 0,
          count: variantB._count.score,
        },
        hasEnoughData,
        winner: hasEnoughData
          ? (variantA._avg.score ?? 0) >= (variantB._avg.score ?? 0)
            ? 'A'
            : 'B'
          : null,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
