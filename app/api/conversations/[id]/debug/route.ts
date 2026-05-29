/**
 * GET /api/conversations/[id]/debug
 *
 * Returns the persisted per-turn debug records for a conversation so the dev
 * debug panel can replay prior turns across reloads. Dev-only: returns 404 in
 * production (the panel is dev-only, and the payloads contain full prompts +
 * customer data — forensic prod access goes through the DB directly, not here).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isDev } from '@/lib/chat/debug'
import { logError } from '@/lib/errors/logger'
import type { DebugTurn } from '@/lib/debug/reducer'

const MAX_TURNS = 50

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDev()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params

  try {
    const rows = await prisma.turnDebug.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: MAX_TURNS,
      select: { payload: true },
    })
    const turns = rows.map((r) => r.payload as unknown as DebugTurn)
    return NextResponse.json({ turns })
  } catch (err) {
    logError({
      layer: 'api',
      category: 'turn_debug',
      message: 'Failed to load conversation debug',
      context: { conversationId: id },
      error: err,
    })
    return NextResponse.json({ turns: [] })
  }
}
