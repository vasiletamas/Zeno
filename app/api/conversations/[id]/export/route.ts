/**
 * GET /api/conversations/[id]/export
 *
 * Returns a complete, self-contained JSON export of a conversation: the full
 * dialogue (messages) plus the per-turn debug replay (state, prompt, every tool
 * call + result, narration, totals) from the persisted TurnDebug records. Used
 * by the debug drawer's "download" button. Dev-only (404 in production) — the
 * payload contains full prompts + customer data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isDev } from '@/lib/chat/debug'
import { logError } from '@/lib/errors/logger'
import type { DebugTurn } from '@/lib/debug/reducer'
import {
  buildConversationExport,
  type ConversationExportMeta,
  type ConversationExportMessage,
  type CommitLedgerExportRow,
} from '@/lib/debug/conversation-export'

const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDev()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        customerId: true,
        productId: true,
        candidateProductId: true,
        status: true,
        language: true,
        mode: true,
        startedAt: true,
        createdAt: true,
      },
    })

    if (!conversation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const [messageRows, turnRows, ledgerRows] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, toolCalls: true, toolResults: true, createdAt: true },
      }),
      prisma.turnDebug.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: { payload: true },
      }),
      prisma.commitLedger.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, tool: true, actor: true, outcome: true, effects: true, reasonCode: true,
          phaseFrom: true, phaseTo: true, idempotencyDisposition: true, targetRef: true, createdAt: true,
        },
      }),
    ])

    const conversationMeta: ConversationExportMeta = {
      id: conversation.id,
      customerId: conversation.customerId,
      productId: conversation.productId,
      candidateProductId: conversation.candidateProductId,
      status: String(conversation.status),
      language: conversation.language,
      mode: conversation.mode,
      startedAt: conversation.startedAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
    }

    const messages: ConversationExportMessage[] = messageRows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls ?? null,
      toolResults: m.toolResults ?? null,
      createdAt: m.createdAt.toISOString(),
    }))

    const turns = turnRows.map((r) => r.payload as unknown as DebugTurn)

    const ledger: CommitLedgerExportRow[] = ledgerRows.map((r) => ({
      id: r.id,
      tool: r.tool,
      actor: r.actor,
      outcome: r.outcome,
      effects: r.effects,
      reasonCode: r.reasonCode,
      phaseFrom: r.phaseFrom,
      phaseTo: r.phaseTo,
      idempotencyDisposition: r.idempotencyDisposition,
      targetRef: r.targetRef,
      createdAt: r.createdAt.toISOString(),
    }))

    const bundle = buildConversationExport({
      exportedAt: new Date().toISOString(),
      conversation: conversationMeta,
      messages,
      turns,
      ledger,
    })

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
