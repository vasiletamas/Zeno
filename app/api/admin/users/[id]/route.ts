/**
 * PATCH /api/admin/users/[id]
 *
 * Toggle user isActive status.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Auth check — ADMIN only
    const token = request.cookies.get(COOKIE_NAME)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyToken(token)
    if (!payload || payload.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json()
    const { isActive } = body as { isActive?: boolean }

    if (isActive === undefined) {
      return NextResponse.json(
        { error: 'isActive is required' },
        { status: 400 },
      )
    }

    const user = await prisma.user.update({
      where: { id },
      data: { isActive },
    })

    return NextResponse.json({
      user: { id: user.id, email: user.email, isActive: user.isActive },
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
