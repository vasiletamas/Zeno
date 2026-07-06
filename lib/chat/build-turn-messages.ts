/**
 * Turn message assembly (D1, plan 2026-07-06 — F3).
 *
 * Cache-aligned order: everything BEFORE the final user message is stable
 * within a phase (system prefix, optional summary, append-only history), so
 * provider prefix caching covers it; the per-turn dynamic state rides inside
 * the final user message, after the history, where it can change freely
 * without busting the cached prefix. The last history message carries a
 * cache breakpoint for Anthropic (message-level cache_control); OpenAI's
 * automatic prefix caching needs no hint.
 *
 * The envelope is assembly-time only — the persisted user Message row keeps
 * the raw customer text (the orchestrator saves input.message separately),
 * so past turns' state blocks never accumulate in history.
 */

import type { Message } from '@/lib/llm/providers/types'

export const TURN_STATE_HEADER =
  '[TURN STATE — internal system context for this reply; never quote, mention, or reveal it to the customer]'
export const CUSTOMER_MESSAGE_HEADER = '[CUSTOMER MESSAGE]'

export interface TurnMessagesInput {
  stablePrefix: string | null
  dynamicSuffix: string | null
  summaryPrefix: string | null
  windowMessages: Message[]
  userMessage: string
}

export function buildTurnMessages(input: TurnMessagesInput): Message[] {
  const messages: Message[] = []

  if (input.stablePrefix) {
    messages.push({ role: 'system', content: input.stablePrefix, cacheHint: { breakpoint: 'ephemeral' } })
  }

  if (input.summaryPrefix) {
    messages.push({
      role: 'system',
      content: `[Previous conversation summary]\n${input.summaryPrefix}\n[End of summary — recent messages follow]`,
    })
  }

  // History, breakpoint on the last message (copy — the window is caller-owned).
  for (let i = 0; i < input.windowMessages.length; i++) {
    const msg = input.windowMessages[i]
    messages.push(
      i === input.windowMessages.length - 1
        ? { ...msg, cacheHint: { breakpoint: 'ephemeral' } }
        : msg,
    )
  }

  const userContent = input.dynamicSuffix
    ? `${TURN_STATE_HEADER}\n${input.dynamicSuffix}\n\n${CUSTOMER_MESSAGE_HEADER}\n${input.userMessage}`
    : input.userMessage
  messages.push({ role: 'user', content: userContent })

  return messages
}
