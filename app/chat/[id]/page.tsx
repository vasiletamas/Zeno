import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { cookies } from 'next/headers'
import ChatPage from '@/components/chat/chat-page'
import { DebugProvider } from '@/components/debug/debug-provider'
import { derivePendingCard } from '@/lib/chat/derive-pending-card'

/**
 * /chat/[id] — Conversation UI page.
 *
 * Server component that loads the conversation and its messages from the DB,
 * then renders the client ChatPage component with the data as props.
 *
 * Supports both new conversations (empty messages) and resumed conversations
 * (with existing message history, up to 50 most recent).
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const cookieStore = await cookies()
  const customerId = cookieStore.get('zeno_session')?.value

  // Load conversation with messages
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 50 },
    },
  })

  // T21: a stray id (stale link, back-nav after merge) rejoins the funnel at
  // /chat — which resumes the customer's open conversation — instead of 404ing.
  if (!conversation) redirect('/chat')

  // Convert DB messages to ChatMessage format expected by ChatPage
  const initialMessages = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    isStreaming: false,
    createdAt: m.createdAt,
  }))

  // T9/T12 reload parity: uiActions are live-SSE-only client state — a
  // reload mid-questionnaire loses the pending card. Re-derive it server-side
  // and anchor it on the LAST assistant message so lastActionableId renders
  // it interactive. A derive failure must never break the chat page.
  const lastAssistantId = [...conversation.messages].reverse().find((m) => m.role === 'assistant')?.id ?? null
  let initialUiAction: { messageId: string; action: { type: string; payload: Record<string, unknown> } } | null = null
  if (lastAssistantId) {
    try {
      const pending = await derivePendingCard(conversation.id)
      if (pending) initialUiAction = { messageId: lastAssistantId, action: pending }
    } catch {
      initialUiAction = null
    }
  }

  const isDev = process.env.NODE_ENV === 'development'
  const content = (
    <ChatPage
      conversationId={conversation.id}
      customerId={customerId ?? conversation.customerId}
      initialMessages={initialMessages}
      initialUiAction={initialUiAction}
      language={(conversation.language as 'ro' | 'en') ?? 'ro'}
    />
  )

  return isDev ? <DebugProvider>{content}</DebugProvider> : content
}
