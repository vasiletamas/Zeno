/**
 * Admin Work-Item Queue (M5)
 *
 * Server component. Lists work items (default: OPEN) with kind, priority,
 * reason, and age; rows link to the detail page with resolution actions.
 */

import Link from 'next/link'
import { listWorkItems } from '@/lib/work-items/service'
import type { WorkItemStatus } from '@/lib/generated/prisma/client'

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED', 'ALL'] as const

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: 'bg-red-100 text-red-800',
  HIGH: 'bg-amber-100 text-amber-800',
  MEDIUM: 'bg-linen text-night',
  LOW: 'bg-linen text-muted',
}

function age(from: Date): string {
  const mins = Math.floor((Date.now() - from.getTime()) / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export default async function WorkItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const active = status && STATUSES.includes(status as (typeof STATUSES)[number]) ? status : 'OPEN'
  const items = await listWorkItems(active === 'ALL' ? {} : { status: active as WorkItemStatus })

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Work items</h2>

      <div className="mb-4 flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === 'OPEN' ? '/admin/work-items' : `/admin/work-items?status=${s}`}
            className={`
              rounded-md px-3 py-1.5 text-sm font-medium transition-colors
              ${active === s ? 'bg-forest text-soft-white' : 'border border-warm-border text-muted hover:bg-linen'}
            `}
          >
            {s}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">No work items.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-warm-border bg-soft-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-border text-left text-xs uppercase text-muted">
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Age</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-warm-border last:border-0 hover:bg-linen">
                  <td className="px-4 py-3 font-medium text-night">{item.kind}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLES[item.priority] ?? ''}`}>
                      {item.priority}
                    </span>
                  </td>
                  <td className="max-w-md truncate px-4 py-3 text-night">{item.reason}</td>
                  <td className="px-4 py-3 text-muted">{age(item.createdAt)}</td>
                  <td className="px-4 py-3 text-muted">{item.status}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/work-items/${item.id}`} className="text-forest hover:underline">
                      Open
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
