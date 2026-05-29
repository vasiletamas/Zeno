/**
 * Persist one turn's full debug record to the TurnDebug table.
 *
 * Fire-and-forget from the orchestrator at turn-end. Reduces the accumulated
 * debug events into the same DebugTurn shape the panel renders, then upserts
 * by traceId (idempotent). DB failures are logged and swallowed — debug
 * persistence must never break or delay the user-facing turn.
 */

import { prisma } from '@/lib/db'
import { logError } from '@/lib/errors/logger'
import { buildTurnDebugPayload } from '@/lib/debug/reducer'
import type { DebugEvent } from './debug'

export interface PersistTurnDebugInput {
  conversationId: string
  messageIndex: number
  traceId: string
  events: DebugEvent[]
}

export async function persistTurnDebug(input: PersistTurnDebugInput): Promise<void> {
  const payload = buildTurnDebugPayload(input.events)
  if (!payload) return

  // Round-trip through JSON to drop any non-serializable values, matching the
  // existing turnTrace.create pattern in orchestrator.ts.
  const json = JSON.parse(JSON.stringify(payload))

  try {
    await prisma.turnDebug.upsert({
      where: { traceId: input.traceId },
      create: {
        conversationId: input.conversationId,
        messageIndex: input.messageIndex,
        traceId: input.traceId,
        payload: json,
      },
      update: {
        messageIndex: input.messageIndex,
        payload: json,
      },
    })
  } catch (err) {
    logError({
      layer: 'orchestrator',
      category: 'turn_debug',
      message: 'TurnDebug write error',
      context: { conversationId: input.conversationId },
      error: err,
    })
  }
}
