/**
 * GET /api/conversations/[id]/replay (F2.3, T14.D2)
 *
 * Recompute-and-diff over the conversation's stored legality snapshots.
 * Dev-only (404 in production), mirroring the export route's guard.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isDev } from '@/lib/chat/debug'
import { engineVersion } from '@/lib/engines/derive-and-expose'
import { recomputeAndDiff } from '@/lib/debug/recompute-diff'
import { logError } from '@/lib/errors/logger'
import type { DebugTurn } from '@/lib/debug/reducer'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDev()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const { id } = await params
  try {
    const rows = await prisma.turnDebug.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: { payload: true },
    })
    const turns = rows.map((r) => r.payload as unknown as DebugTurn)
    const diffs = recomputeAndDiff(turns, { currentEngineVersion: engineVersion })
    return NextResponse.json({ engineVersion, diffs })
  } catch (err) {
    logError({
      layer: 'api',
      category: 'conversation_replay',
      message: 'Failed to replay conversation',
      context: { conversationId: id },
      error: err,
    })
    return NextResponse.json({ error: 'Replay failed' }, { status: 500 })
  }
}
