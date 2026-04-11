/**
 * POST /api/admin/skill-packs/flush-cache
 *
 * Flush the in-memory skill pack cache.
 * Protected: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'
import { flushSkillPackCache } from '@/lib/skills/skill-pack-loader'

export async function POST(request: NextRequest) {
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

    flushSkillPackCache()

    return NextResponse.json({ flushed: true })
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
