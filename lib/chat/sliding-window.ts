/**
 * Sliding Window — Dynamic Message Window Management + Summarizer Trigger
 *
 * Manages the conversation message window for LLM calls.
 * When a token budget is provided, loads messages from newest to oldest
 * until the budget is exhausted. Without a budget, falls back to loading
 * the last 20 messages. Generates/retrieves a summary of older messages
 * when the window doesn't cover the full conversation.
 *
 * Exports:
 * - buildSlidingWindow(conversationId, totalMessages, availableTokenBudget?) — build the message window
 */

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import { estimateTokens } from '@/lib/chat/token-budget'
import type { Message } from '@/lib/llm/providers/types'

// ==============================================
// CONSTANTS
// ==============================================

const FALLBACK_WINDOW_SIZE = 20
const MIN_WINDOW_SIZE = 4
const STALE_MESSAGE_THRESHOLD = 10

// ==============================================
// DB MESSAGE → LLM MESSAGE CONVERSION
// ==============================================

function dbMessageToLLM(msg: {
  role: string
  content: string
  toolCalls: unknown
  toolResults: unknown
}): Message {
  // Parse toolCalls from JSON if present
  let toolCalls: Message['toolCalls'] = undefined
  if (msg.toolCalls) {
    const parsed = msg.toolCalls as unknown
    if (Array.isArray(parsed)) {
      toolCalls = parsed as Message['toolCalls']
    }
  }

  return {
    role: msg.role as Message['role'],
    content: msg.content,
    toolCalls,
  }
}

// ==============================================
// BUILD SLIDING WINDOW
// ==============================================

/**
 * Build the sliding window of messages for the LLM call.
 *
 * - If availableTokenBudget is provided: loads messages from newest to oldest
 *   until the budget is exhausted, guaranteeing at least MIN_WINDOW_SIZE messages.
 * - If no budget: falls back to loading the last FALLBACK_WINDOW_SIZE messages.
 * - When the window doesn't cover all messages, generates/retrieves a summary.
 *
 * Returns messages in chronological order (oldest first).
 */
export async function buildSlidingWindow(
  conversationId: string,
  totalMessages: number,
  availableTokenBudget?: number,
): Promise<{ messages: Message[]; summaryPrefix: string | null }> {
  const useTokenBudget = availableTokenBudget !== undefined && availableTokenBudget > 0
  const maxToLoad = useTokenBudget ? totalMessages : Math.min(totalMessages, FALLBACK_WINDOW_SIZE)

  if (totalMessages <= MIN_WINDOW_SIZE) {
    // Load all messages in chronological order
    const dbMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })

    return { messages: dbMessages.map(dbMessageToLLM), summaryPrefix: null }
  }

  // Load messages (desc then reverse for chronological order)
  const dbMessagesDesc = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: maxToLoad,
  })

  const dbMessagesAsc = dbMessagesDesc.reverse()
  const allMessages = dbMessagesAsc.map(dbMessageToLLM)

  // Determine the window of messages to include
  let windowMessages: Message[]
  if (useTokenBudget) {
    // Walk from newest to oldest, accumulating tokens
    let tokenCount = 0
    let startIndex = allMessages.length

    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msgTokens = estimateTokens(allMessages[i].content, 'en')
      if (tokenCount + msgTokens > availableTokenBudget && startIndex < allMessages.length - MIN_WINDOW_SIZE + 1) {
        break
      }
      tokenCount += msgTokens
      startIndex = i
    }

    windowMessages = allMessages.slice(startIndex)
  } else {
    windowMessages = allMessages.slice(-FALLBACK_WINDOW_SIZE)
  }

  // If window covers all messages, no summary needed
  if (windowMessages.length >= totalMessages) {
    return { messages: windowMessages, summaryPrefix: null }
  }

  // Check for existing summary — stale-while-revalidate strategy
  const olderCount = totalMessages - windowMessages.length

  const existingSummary = await prisma.conversationSummary.findUnique({
    where: { conversationId },
  })

  if (existingSummary) {
    // Any existing summary — use it immediately (stale-while-revalidate)
    if (olderCount - existingSummary.messagesUpTo > STALE_MESSAGE_THRESHOLD) {
      // Stale: fire background refresh (non-blocking)
      void refreshSummaryInBackground(conversationId, olderCount)
    }
    return { messages: windowMessages, summaryPrefix: existingSummary.summary }
  }

  // No summary at all — must block on summarizer to generate one
  const olderMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: olderCount,
  })

  const olderLLMMessages = olderMessages.map(dbMessageToLLM)
  const summaryText = await triggerSummarizer(
    conversationId,
    olderLLMMessages,
    olderCount,
  )

  return { messages: windowMessages, summaryPrefix: summaryText }
}

// ==============================================
// SUMMARIZER TRIGGER
// ==============================================

/**
 * Format messages into a readable string for the summarizer.
 */
function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map((msg) => {
      const role =
        msg.role === 'user'
          ? 'Customer'
          : msg.role === 'assistant'
            ? 'Agent'
            : msg.role === 'system'
              ? 'System'
              : 'Tool'
      return `${role}: ${msg.content}`
    })
    .join('\n')
}

/**
 * Trigger the summarizer agent to summarize older messages.
 * Synchronous — blocks until summary is generated (we need it for this turn).
 */
async function triggerSummarizer(
  conversationId: string,
  messagesToSummarize: Message[],
  messagesUpTo: number,
): Promise<string> {
  const formattedMessages = formatMessagesForSummary(messagesToSummarize)

  const response = await gateway.call('summarizer', {
    messages: [{ role: 'user', content: formattedMessages }],
  })

  const summaryText = response.content ?? ''

  // Upsert the ConversationSummary record
  await prisma.conversationSummary.upsert({
    where: { conversationId },
    update: {
      summary: summaryText,
      messagesUpTo,
    },
    create: {
      conversationId,
      summary: summaryText,
      messagesUpTo,
    },
  })

  return summaryText
}

// ==============================================
// BACKGROUND REFRESH (Incremental Summarization)
// ==============================================

/**
 * Refresh the summary in the background using incremental summarization.
 * Fire-and-forget — errors are silently swallowed.
 */
async function refreshSummaryInBackground(
  conversationId: string,
  targetMessagesUpTo: number,
): Promise<void> {
  try {
    const existingSummary = await prisma.conversationSummary.findUnique({
      where: { conversationId },
    })

    if (!existingSummary) return

    // Load only NEW messages since the last summary
    const newMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      skip: existingSummary.messagesUpTo,
      take: targetMessagesUpTo - existingSummary.messagesUpTo,
    })

    if (newMessages.length === 0) return

    const newMessagesFormatted = formatMessagesForSummary(newMessages.map(dbMessageToLLM))

    const incrementalPrompt = `Existing summary of the conversation so far:\n${existingSummary.summary}\n\nNew messages since then:\n${newMessagesFormatted}\n\nExtend the summary to include the new messages. Keep it concise.`

    const response = await gateway.call('summarizer', {
      messages: [{ role: 'user', content: incrementalPrompt }],
    })

    const updatedSummary = response.content ?? ''

    await prisma.conversationSummary.upsert({
      where: { conversationId },
      update: {
        summary: updatedSummary,
        messagesUpTo: targetMessagesUpTo,
      },
      create: {
        conversationId,
        summary: updatedSummary,
        messagesUpTo: targetMessagesUpTo,
      },
    })
  } catch {
    // Background operation — silently swallow errors
  }
}

// ==============================================
// PROACTIVE STALENESS CHECK (called from orchestrator)
// ==============================================

/**
 * Check if the conversation summary is stale and trigger a background refresh if needed.
 * Called from orchestrator Step 9 as a fire-and-forget operation.
 */
export async function updateSummaryIfStale(
  conversationId: string,
  currentMessageCount: number,
): Promise<void> {
  const existingSummary = await prisma.conversationSummary.findUnique({
    where: { conversationId },
  })

  // No summary exists — will be created on demand by buildSlidingWindow
  if (!existingSummary) return

  const gap = currentMessageCount - existingSummary.messagesUpTo
  if (gap > STALE_MESSAGE_THRESHOLD) {
    await refreshSummaryInBackground(conversationId, currentMessageCount)
  }
}
