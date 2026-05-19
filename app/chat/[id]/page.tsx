import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { cookies } from 'next/headers'
import ChatPage from '@/components/chat/chat-page'
import { DebugProvider } from '@/components/debug/debug-provider'

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

  if (!conversation) notFound()

  // Convert DB messages to ChatMessage format expected by ChatPage
  const initialMessages = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    isStreaming: false,
    createdAt: m.createdAt,
  }))

  const isDev = process.env.NODE_ENV === 'development'
  const content = (
    <ChatPage
      conversationId={conversation.id}
      customerId={customerId ?? conversation.customerId}
      initialMessages={initialMessages}
      language={(conversation.language as 'ro' | 'en') ?? 'ro'}
    />
  )

  return isDev ? <DebugProvider>{content}</DebugProvider> : content
}
