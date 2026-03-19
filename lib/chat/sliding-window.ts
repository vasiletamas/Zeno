/**
 * Sliding Window — Message Window Management + Summarizer Trigger
 *
 * Manages the conversation message window for LLM calls.
 * When conversations exceed 20 messages, loads only the last 20 and
 * generates/retrieves a summary of older messages.
 *
 * Exports:
 * - buildSlidingWindow(conversationId, totalMessages) — build the message window
 */

import { prisma } from '@/lib/db'
import { gateway } from '@/lib/llm/gateway'
import type { Message } from '@/lib/llm/providers/types'

// ==============================================
// CONSTANTS
// ==============================================

const WINDOW_SIZE = 20

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
 * - If totalMessages <= 20: load all messages, no summary
 * - If totalMessages > 20: load last 20 + generate/retrieve summary of older
 *
 * Returns messages in chronological order (oldest first).
 */
export async function buildSlidingWindow(
  conversationId: string,
  totalMessages: number,
): Promise<{ messages: Message[]; summaryPrefix: string | null }> {
  if (totalMessages <= WINDOW_SIZE) {
    // Load all messages in chronological order
    const dbMessages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    })

    const messages = dbMessages.map(dbMessageToLLM)
    return { messages, summaryPrefix: null }
  }

  // totalMessages > 20: load last 20 (desc then reverse)
  const last20Desc = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: WINDOW_SIZE,
  })
  const last20 = last20Desc.reverse()
  const messages = last20.map(dbMessageToLLM)

  // Check for existing summary
  const existingSummary = await prisma.conversationSummary.findUnique({
    where: { conversationId },
  })

  const olderCount = totalMessages - WINDOW_SIZE

  if (existingSummary && existingSummary.messagesUpTo >= olderCount) {
    // Summary is current — use it
    return { messages, summaryPrefix: existingSummary.summary }
  }

  // No summary or stale — load older messages and trigger summarizer
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

  return { messages, summaryPrefix: summaryText }
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
