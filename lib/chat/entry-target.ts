/**
 * T21 (P5.4): pure /chat entry decision. The session response may carry
 * activeConversationId (the customer's latest ACTIVE conversation) — the
 * entry resumes it instead of minting a new conversation, unless the
 * customer explicitly asked for a fresh one (?new=1).
 */

export interface EntrySession {
  customerId?: string
  activeConversationId?: string | null
}

export type EntryTarget =
  | { kind: 'resume'; conversationId: string }
  | { kind: 'create' }

export function resolveEntryTarget(session: EntrySession, forceNew: boolean): EntryTarget {
  if (!forceNew && session.activeConversationId) {
    return { kind: 'resume', conversationId: session.activeConversationId }
  }
  return { kind: 'create' }
}
