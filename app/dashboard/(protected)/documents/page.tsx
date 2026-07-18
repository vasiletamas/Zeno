/**
 * Customer Documents Page (server component)
 *
 * T25 (P5.5): the full document library — every signed, acknowledged,
 * generated and uploaded artifact, grouped per product where a link
 * exists. Thin server component over lib/documents/library.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import { listCustomerDocuments } from '@/lib/documents/library'
import DocumentLibrary from '@/components/dashboard/document-library'

export default async function DocumentsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/dashboard/login')

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'CUSTOMER') redirect('/dashboard/login')

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { customerId: true },
  })
  if (!user?.customerId) redirect('/dashboard/login')

  const library = await listCustomerDocuments(user.customerId)
  const serialize = (items: typeof library.ungrouped) =>
    items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
      acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null,
    }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-medium text-night">
        Documente
      </h1>
      <DocumentLibrary
        groups={library.groups.map((g) => ({ ...g, items: serialize(g.items) }))}
        ungrouped={serialize(library.ungrouped)}
      />
    </div>
  )
}
