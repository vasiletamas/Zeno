/**
 * GET /api/admin/skill-packs
 *
 * List all skill packs ordered by category, priority (desc), name.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
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

    const skillPacks = await prisma.skillPack.findMany({
      orderBy: [{ category: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json(skillPacks)
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
