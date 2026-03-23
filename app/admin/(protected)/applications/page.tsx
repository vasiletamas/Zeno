/**
 * Admin Applications List
 *
 * Server component. Loads applications with customer + product includes.
 * Supports status filter via URL search param.
 */

import { prisma } from '@/lib/db'
import ApplicationTable from '@/components/admin/application-table'
import Link from 'next/link'

const STATUSES = ['ALL', 'OPEN', 'PAUSED', 'COMPLETED'] as const

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const statusFilter =
    status && status !== 'ALL'
      ? (status as 'OPEN' | 'PAUSED' | 'COMPLETED')
      : undefined

  const applications = await prisma.application.findMany({
    where: statusFilter ? { status: statusFilter } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: { select: { name: true, email: true } },
      product: { select: { name: true } },
    },
  })

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Aplicatii</h2>

      {/* Status filter */}
      <div className="mb-4 flex gap-2">
        {STATUSES.map((s) => {
          const isActive = s === 'ALL' ? !status || status === 'ALL' : status === s
          return (
            <Link
              key={s}
              href={s === 'ALL' ? '/admin/applications' : `/admin/applications?status=${s}`}
              className={`
                rounded-md px-3 py-1.5 text-sm font-medium transition-colors
                ${
                  isActive
                    ? 'bg-forest text-soft-white'
                    : 'border border-warm-border text-muted hover:bg-linen'
                }
              `}
            >
              {s === 'ALL' ? 'Toate' : s}
            </Link>
          )
        })}
      </div>

      <ApplicationTable applications={applications} />
    </div>
  )
}
