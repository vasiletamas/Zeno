/**
 * Pure helper: assemble a complete, self-contained export of a conversation —
 * the full dialogue plus the per-turn debug replay (state, prompt, every tool
 * call + result, narration, totals). Tested directly; the API route is a thin
 * wrapper that fetches the rows and the drawer's Download button serializes the
 * result to a JSON file.
 */

import type { DebugTurn } from './reducer'

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
  exportedAt: string
  conversationId: string
  conversation: ConversationExportMeta
  summary: ConversationExportSummary
  messages: ConversationExportMessage[]
  /** Chronological (messageIndex ascending) — replay order. */
  turns: DebugTurn[]
}

export function buildConversationExport(input: {
  exportedAt: string
  conversation: ConversationExportMeta
  messages: ConversationExportMessage[]
  turns: DebugTurn[]
}): ConversationExport {
  const turns = [...input.turns].sort((a, b) => a.messageIndex - b.messageIndex)
  const toolCalls = turns.reduce((n, t) => n + t.toolCalls.length, 0)
  const toolsUsed = [...new Set(turns.flatMap((t) => t.toolCalls.map((c) => c.name)))].sort()

  return {
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
  }
}
