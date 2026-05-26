/**
 * Conversation phase classification.
 *
 * Derived from existing state — no `Conversation.phase` column.
 * See docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
 */

export type ConversationPhase = 'presentation' | 'application' | 'post_sale'

export interface PhaseInput {
  mode: string
  application: { status: string } | null
}

export function getConversationPhase(conv: PhaseInput): ConversationPhase {
  if (conv.mode === 'POST_SALE') return 'post_sale'
  if (
    conv.application &&
    conv.application.status !== 'COMPLETED' &&
    conv.application.status !== 'ABANDONED'
  ) {
    return 'application'
  }
  return 'presentation'
}
