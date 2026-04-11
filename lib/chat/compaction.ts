import { gateway } from '@/lib/llm/gateway'
import { estimateTokens } from '@/lib/chat/token-budget'
import type { Message } from '@/lib/llm/providers/types'

const GROUP_SIZE = 10
const MIN_TOKENS_PER_MESSAGE = 15

export function groupMessages(messages: Message[], groupSize: number): Message[][] {
  const groups: Message[][] = []
  for (let i = 0; i < messages.length; i += groupSize) {
    groups.push(messages.slice(i, i + groupSize))
  }
  return groups
}

export async function compactMessages(
  messages: Message[],
  tokenDeficit: number,
  conversationId: string,
): Promise<Message[]> {
  let systemPrefix: Message[] = []
  let conversationMessages: Message[] = messages

  const firstNonSystem = messages.findIndex((m) => m.role !== 'system')
  if (firstNonSystem > 0) {
    systemPrefix = messages.slice(0, firstNonSystem)
    conversationMessages = messages.slice(firstNonSystem)
  }

  if (conversationMessages.length < 4) {
    return messages
  }

  const groups = groupMessages(conversationMessages, GROUP_SIZE)

  let tokensFreed = 0
  let groupsToCompress = 0

  for (const group of groups) {
    if (tokensFreed >= tokenDeficit) break
    if (groupsToCompress >= groups.length - 1) break

    const groupTokens = group.reduce(
      (sum, msg) => sum + Math.max(estimateTokens(msg.content, 'en'), MIN_TOKENS_PER_MESSAGE),
      0,
    )
    tokensFreed += groupTokens
    groupsToCompress++
  }

  if (groupsToCompress === 0) return messages

  const messagesToCompress = groups.slice(0, groupsToCompress).flat()
  const remainingMessages = groups.slice(groupsToCompress).flat()

  const formatted = messagesToCompress
    .map((msg) => {
      const role = msg.role === 'user' ? 'Customer' : msg.role === 'assistant' ? 'Agent' : 'System'
      return `${role}: ${msg.content}`
    })
    .join('\n')

  const response = await gateway.call('summarizer', {
    messages: [{ role: 'user', content: formatted }],
  })

  const summaryText = response.content ?? 'Previous conversation context unavailable.'

  const summaryMessage: Message = {
    role: 'system',
    content: `[Compacted summary of ${messagesToCompress.length} earlier messages]\n${summaryText}\n[End of compacted summary — recent messages follow]`,
  }

  return [...systemPrefix, summaryMessage, ...remainingMessages]
}
