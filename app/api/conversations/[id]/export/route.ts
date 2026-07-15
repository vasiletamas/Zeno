/**
 * GET /api/conversations/[id]/export
 *
 * Returns a complete, self-contained JSON export of a conversation (v2:
 * schemaVersion + commit ledger + per-turn debug replay). Thin wrapper over
 * lib/debug/load-export.ts — the sim generator records fixtures through the
 * SAME loader (F1.9). Dev-only (404 in production) — the payload contains
 * full prompts + customer data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { isDev } from '@/lib/chat/debug'
import { logError } from '@/lib/errors/logger'
import { loadConversationExport } from '@/lib/debug/load-export'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDev()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params

  try {
    const bundle = await loadConversationExport(id)
    if (!bundle) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(bundle)
  } catch (err) {
    logError({
      layer: 'api',
      category: 'conversation_export',
      message: 'Failed to export conversation',
      context: { conversationId: id },
      error: err,
    })
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
