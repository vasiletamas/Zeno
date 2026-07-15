/**
 * Pure helper: assemble a complete, self-contained export of a conversation —
 * the full dialogue plus the per-turn debug replay (state, prompt, every tool
 * call + result, narration, totals). Tested directly; the API route is a thin
 * wrapper that fetches the rows and the drawer's Download button serializes the
 * result to a JSON file.
 */

import type { DebugTurn } from './reducer'

/**
 * F2.5 (M8 pin 2): the export is a versioned contract. v2 adds the commit
 * ledger — the ground truth lib/testing/conversation-assertions.ts joins
 * turns against (via post_commit legality commitLedgerId, erratum 2).
 */
export const EXPORT_SCHEMA_VERSION = 2 as const

/** Typed mirror of the CommitLedger row (envelope/argsHash omitted). */
export interface CommitLedgerExportRow {
  id: string
  tool: string
  actor: string
  outcome: string
  effects: string[]
  reasonCode: string | null
  phaseFrom: string | null
  phaseTo: string | null
  idempotencyDisposition: string
  targetRef: string | null
  createdAt: string
}

export interface ConversationExportMeta {
  id: string
  customerId: string
  productId: string | null
  candidateProductId: string | null
  status: string
  language: string
  mode: string
  startedAt: string
  createdAt: string
}

export interface ConversationExportMessage {
  id: string
  role: string
  content: string
  toolCalls: unknown
  toolResults: unknown
  createdAt: string
}

export interface ConversationExportSummary {
  turns: number
  messages: number
  toolCalls: number
  toolsUsed: string[]
}

export interface ConversationExport {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION
  exportedAt: string
  conversationId: string
  conversation: ConversationExportMeta
  summary: ConversationExportSummary
  messages: ConversationExportMessage[]
  /** Chronological (messageIndex ascending) — replay order. */
  turns: DebugTurn[]
  /** Every CommitLedger row for the conversation, createdAt ascending. */
  ledger: CommitLedgerExportRow[]
}

export function buildConversationExport(input: {
  exportedAt: string
  conversation: ConversationExportMeta
  messages: ConversationExportMessage[]
  turns: DebugTurn[]
  ledger?: CommitLedgerExportRow[]
}): ConversationExport {
  const turns = [...input.turns].sort((a, b) => a.messageIndex - b.messageIndex)
  const toolCalls = turns.reduce((n, t) => n + t.toolCalls.length, 0)
  const toolsUsed = [...new Set(turns.flatMap((t) => t.toolCalls.map((c) => c.name)))].sort()
  const ledger = [...(input.ledger ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    conversationId: input.conversation.id,
    conversation: input.conversation,
    summary: {
      turns: turns.length,
      messages: input.messages.length,
      toolCalls,
      toolsUsed,
    },
    messages: input.messages,
    turns,
    ledger,
  }
}
