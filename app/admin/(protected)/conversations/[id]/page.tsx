/**
 * Conversation Detail Page — ADMIN only
 *
 * Server component. Loads conversation with all messages + turn traces.
 */

import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import ConversationViewer from '@/components/admin/conversation-viewer'

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // ADMIN-only check
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, email: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      turnTraces: { orderBy: { messageIndex: 'asc' } },
    },
  })

  if (!conversation) {
    notFound()
  }

  // Serialize dates for client component
  const serializedMessages = JSON.parse(JSON.stringify(conversation.messages))
  const serializedTraces = JSON.parse(JSON.stringify(conversation.turnTraces))

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium text-night">
            Conversatie — {conversation.customer.name ?? conversation.customer.email ?? 'Anonim'}
          </h2>
          <p className="text-sm text-muted">
            {conversation.messageCount} mesaje — Status: {conversation.status}
          </p>
        </div>
      </div>

      <ConversationViewer
        messages={serializedMessages}
        turnTraces={serializedTraces}
      />
    </div>
  )
}
