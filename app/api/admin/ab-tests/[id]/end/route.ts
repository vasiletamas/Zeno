/**
 * POST /api/admin/ab-tests/:id/end
 *
 * End an active A/B test.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function POST(
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
    if (!test.isActive) return NextResponse.json({ error: 'Test is already ended' }, { status: 400 })

    await prisma.aBTestVariant.update({
      where: { id },
      data: { isActive: false, endedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
