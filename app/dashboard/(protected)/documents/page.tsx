/**
 * Customer Documents Page (server component)
 *
 * Full page document list. Same documents as dashboard but dedicated page.
 * Load policies -> check status -> show document availability.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import DocumentList from '@/components/dashboard/document-list'

export default async function DocumentsPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/dashboard/login')

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'CUSTOMER') redirect('/dashboard/login')

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      customer: {
        include: {
          policies: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  })

  if (!user?.customer) {
    redirect('/dashboard/login')
  }

  const latestPolicy = user.customer.policies[0]
  const isActive = latestPolicy?.status === 'ACTIVE'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-medium text-night">
        Documente
      </h1>

      {!latestPolicy ? (
        <div className="rounded-xl border border-warm-border bg-linen px-6 py-8 text-center">
          <p className="text-sm text-muted">
            Nu ai documente disponibile. Vorbeste cu Zeno pentru a obtine o polita.
          </p>
        </div>
      ) : (
        <DocumentList
          policyActive={isActive}
          policyId={latestPolicy.id}
          suitabilityReportPath={latestPolicy.suitabilityReportPath}
        />
      )}
    </div>
  )
}
