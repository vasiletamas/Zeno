/**
 * POST /api/admin/skill-packs/[id]/toggle
 *
 * Toggle the isActive flag of a skill pack.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'

export async function POST(
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

    const existing = await prisma.skillPack.findUnique({
      where: { id },
      select: { isActive: true },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const skillPack = await prisma.skillPack.update({
      where: { id },
      data: { isActive: !existing.isActive },
    })

    flushSkillPackCache()

    return NextResponse.json({ id: skillPack.id, isActive: skillPack.isActive })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
