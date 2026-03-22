/**
 * GET /api/admin/stats
 *
 * Returns dashboard summary counts.
 * Protected: ADMIN or OPERATOR.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload || (payload.role !== 'ADMIN' && payload.role !== 'OPERATOR')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [openApplications, pendingPolicies, activePolicies, conversationsToday] =
      await Promise.all([
        prisma.application.count({ where: { status: 'OPEN' } }),
        prisma.policy.count({
          where: { status: { in: ['PENDING_SUBMISSION', 'SUBMITTED'] } },
        }),
        prisma.policy.count({ where: { status: 'ACTIVE' } }),
        prisma.conversation.count({ where: { createdAt: { gte: today } } }),
      ])

    return NextResponse.json({
      openApplications,
      pendingPolicies,
      activePolicies,
      conversationsToday,
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
