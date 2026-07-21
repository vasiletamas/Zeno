import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { cookies } from 'next/headers'
import ChatPage from '@/components/chat/chat-page'
import { DebugProvider } from '@/components/debug/debug-provider'
import { deriveActiveCards, type ActiveCard } from '@/lib/chat/derive-active-cards'
import { logError } from '@/lib/errors/logger'
import { decideConversationAccess } from '@/lib/chat/conversation-access'
import { PROOF_COOKIE } from '@/lib/auth/session-proof'
import { ConversationReauth } from '@/components/chat/conversation-reauth'

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

  /**
   * ACCESS FIRST — before any conversation data is read (spec 2026-07-21 §3.1,
   * ruling R3). Until 2026-07-21 this page loaded ANY conversation by id with
   * no ownership check and no reauth, then fell back to adopting the
   * conversation's own customer when no cookie was present. The reauth gate
   * lived only on POST /api/session, which a browser-history link never
   * touches — so the shared-device case walked straight in.
   *
   * The ordering is the control, not a detail: a check placed after the read
   * would already have the transcript in memory and one careless prop away
   * from the client.
   */
  const access = await decideConversationAccess({
    conversationId: id,
    cookieCustomerId: cookieStore.get('zeno_session')?.value,
    proofToken: cookieStore.get(PROOF_COOKIE)?.value,
  })

  // T21: a stray id (stale link, back-nav after merge) rejoins the funnel at
  // /chat — which resumes the customer's open conversation — instead of 404ing.
  // A FOREIGN id lands here too, and deliberately looks identical: a distinct
  // "exists but not yours" would confirm the id to whoever probed it.
  if (access.kind === 'deny') redirect('/chat')

  if (access.kind === 'reauth') {
    return <ConversationReauth maskedEmail={access.maskedEmail} />
  }

  const customerId = access.customerId

  // Load conversation with messages — reachable only for the proven owner.
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 50 },
    },
  })
  if (!conversation) redirect('/chat')

  // Convert DB messages to ChatMessage format expected by ChatPage
  const initialMessages = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    isStreaming: false,
    createdAt: m.createdAt,
  }))

  // Reload parity (spec 2026-07-20 §2): the FULL derived card set replaces
  // the old single-card derivePendingCard seed — every pending input card
  // (data_field/otp/question) re-renders after a reload with its true
  // status. A derive failure must never break the chat page.
  let initialCards: ActiveCard[] = []
  try {
    initialCards = await deriveActiveCards(conversation.id)
  } catch (e) {
    logError({ layer: 'api', category: 'cards_state', message: 'reload card derivation failed', context: { conversationId: conversation.id }, error: e })
  }

  const isDev = process.env.NODE_ENV === 'development'
  const content = (
    <ChatPage
      conversationId={conversation.id}
      customerId={customerId}
      initialMessages={initialMessages}
      initialCards={initialCards}
      language={(conversation.language as 'ro' | 'en') ?? 'ro'}
    />
  )

  return isDev ? <DebugProvider>{content}</DebugProvider> : content
}
