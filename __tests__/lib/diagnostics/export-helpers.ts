/** Shared literal-export builders for the diagnostics test ring. */
import type { ConversationExport } from '@/lib/debug/conversation-export'

export function makeExport(over: Partial<ConversationExport> = {}): ConversationExport {
  return { schemaVersion: 2, exportedAt: 'x', conversationId: 'c1',
    conversation: { id: 'c1', status: 'ACTIVE' } as never,
    summary: { turns: 0, messages: 0, toolCalls: 0, toolsUsed: [] },
    messages: [], turns: [], ledger: [], ...over } as never
}

export const legality = (state: Record<string, unknown>, actions: { available: string[]; blocked: { action: string; reason: string }[] } = { available: [], blocked: [] }) =>
  [{ point: 'turn_start', engineVersion: 'test-x', contentVersions: [], snapshot: {}, state, actions }]

export const turn = (i: number, over: Record<string, unknown> = {}) => ({
  traceId: `t${i}`, conversationId: 'c1', messageIndex: i, userMessage: 'u', language: 'ro',
  startedAt: 0, endedAt: 1, toolCalls: [], totals: { phases: {}, totalInputTokens: 0, totalOutputTokens: 0, cost: 0, latencyMs: 900, anomalies: [] }, ...over,
}) as never
