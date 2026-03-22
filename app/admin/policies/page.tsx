/**
 * Admin Policies Page
 *
 * Server component. Loads policies with customer + quote includes.
 * Supports status filter. Inline actions for status updates.
 */

import { prisma } from '@/lib/db'
import PolicyTable from '@/components/admin/policy-table'
import Link from 'next/link'

const STATUSES = ['ALL', 'PENDING_SUBMISSION', 'SUBMITTED', 'ACTIVE', 'CANCELLED', 'EXPIRED'] as const

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const statusFilter =
    status && status !== 'ALL'
      ? (status as 'PENDING_SUBMISSION' | 'SUBMITTED' | 'ACTIVE' | 'CANCELLED' | 'EXPIRED')
      : undefined

  const policies = await prisma.policy.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { name: true, email: true } },
      quote: {
        include: {
          application: {
            include: {
              product: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  // Serialize for client component
  const serialized = JSON.parse(JSON.stringify(policies))

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Polite</h2>

      {/* Status filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => {
          const isActive = s === 'ALL' ? !status || status === 'ALL' : status === s
          return (
            <Link
              key={s}
              href={s === 'ALL' ? '/admin/policies' : `/admin/policies?status=${s}`}
              className={`
                rounded-md px-3 py-1.5 text-sm font-medium transition-colors
                ${
                  isActive
                    ? 'bg-forest text-soft-white'
                    : 'border border-warm-border text-muted hover:bg-linen'
                }
              `}
            >
              {s === 'ALL' ? 'Toate' : s.replace('_', ' ')}
            </Link>
          )
        })}
      </div>

      <PolicyTable policies={serialized} />
    </div>
  )
}
