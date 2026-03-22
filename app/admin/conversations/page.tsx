/**
 * Conversations List — ADMIN only
 *
 * Server component. Loads conversations with customer and message count.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import Link from 'next/link'

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-sage/10 text-sage',
    IDLE: 'bg-sand/10 text-sand',
    COMPLETED: 'bg-forest/10 text-forest',
    ABANDONED: 'bg-muted/10 text-muted',
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-muted/10 text-muted'}`}
    >
      {status}
    </span>
  )
}

export default async function ConversationsPage() {
  // ADMIN-only check
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/admin/login')
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') redirect('/admin')

  const conversations = await prisma.conversation.findMany({
    orderBy: { lastActivityAt: 'desc' },
    take: 100,
    include: {
      customer: { select: { name: true, email: true } },
    },
  })

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Conversatii</h2>

      {conversations.length === 0 ? (
        <p className="rounded-lg border border-warm-border bg-white p-6 text-center text-sm text-muted">
          Nu exista conversatii.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-warm-border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-warm-border bg-linen/50">
                <th className="px-4 py-3 font-medium text-muted">Client</th>
                <th className="px-4 py-3 font-medium text-muted">Status</th>
                <th className="px-4 py-3 font-medium text-muted">Mesaje</th>
                <th className="px-4 py-3 font-medium text-muted">Ultima activitate</th>
                <th className="px-4 py-3 font-medium text-muted"></th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((conv) => (
                <tr
                  key={conv.id}
                  className="border-b border-warm-border last:border-0 hover:bg-linen/30 transition-colors"
                >
                  <td className="px-4 py-3 text-night">
                    {conv.customer.name ?? conv.customer.email ?? 'Anonim'}
                  </td>
                  <td className="px-4 py-3">{statusBadge(conv.status)}</td>
                  <td className="px-4 py-3 text-night">{conv.messageCount}</td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(conv.lastActivityAt).toLocaleString('ro-RO')}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/conversations/${conv.id}`}
                      className="text-sage hover:underline"
                    >
                      Detalii
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
