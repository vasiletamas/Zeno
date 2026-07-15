/**
 * Shared ConversationExport loader (F1.9): the export route and the sim
 * generator/diagnostic scripts assemble the bundle through this ONE path,
 * so recorded fixtures and the drawer download can never drift apart.
 */
import { prisma } from '@/lib/db'
import type { DebugTurn } from './reducer'
import {
  buildConversationExport,
  type ConversationExport,
  type ConversationExportMeta,
  type ConversationExportMessage,
  type CommitLedgerExportRow,
} from './conversation-export'

export async function loadConversationExport(conversationId: string): Promise<ConversationExport | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
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
  if (!conversation) return null

  const [messageRows, turnRows, ledgerRows] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, toolCalls: true, toolResults: true, createdAt: true },
    }),
    prisma.turnDebug.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { payload: true },
    }),
    prisma.commitLedger.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, tool: true, actor: true, outcome: true, effects: true, reasonCode: true,
        phaseFrom: true, phaseTo: true, idempotencyDisposition: true, targetRef: true, createdAt: true,
      },
    }),
  ])

  const meta: ConversationExportMeta = {
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

  return buildConversationExport({
    exportedAt: new Date().toISOString(),
    conversation: meta,
    messages,
    turns: turnRows.map((r) => r.payload as unknown as DebugTurn),
    ledger,
  })
}
