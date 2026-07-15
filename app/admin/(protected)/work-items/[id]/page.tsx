/**
 * Admin Work-Item Detail
 *
 * Server component. Shows the item's facts (refs, payload, resolution trail)
 * and kind-appropriate resolution actions posting to the resolve route.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import WorkItemActions from '@/components/admin/work-item-actions'

export default async function WorkItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const item = await prisma.workItem.findUnique({ where: { id } })
  if (!item) notFound()

  return (
    <div className="max-w-3xl">
      <Link href="/admin/work-items" className="text-sm text-muted hover:underline">
        ← Work items
      </Link>
      <h2 className="mb-1 mt-2 text-xl font-medium text-night">
        {item.kind} <span className="text-muted">· {item.priority}</span>
      </h2>
      <p className="mb-6 text-sm text-muted">
        {item.status} · created by {item.createdBy} · {item.createdAt.toISOString()}
      </p>

      <div className="rounded-lg border border-warm-border bg-soft-white p-4">
        <h3 className="mb-2 text-sm font-medium text-night">Reason</h3>
        <p className="text-sm text-night">{item.reason}</p>

        <h3 className="mb-2 mt-4 text-sm font-medium text-night">Refs</h3>
        <pre className="overflow-x-auto rounded bg-linen p-3 text-xs text-night">
          {JSON.stringify(item.refs, null, 2)}
        </pre>

        {item.payload != null && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-medium text-night">Payload</h3>
            <pre className="overflow-x-auto rounded bg-linen p-3 text-xs text-night">
              {JSON.stringify(item.payload, null, 2)}
            </pre>
          </>
        )}

        {item.status !== 'OPEN' && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-medium text-night">Resolution</h3>
            <p className="text-sm text-night">
              {item.resolutionCode ?? '—'}
              {item.resolution ? ` — ${item.resolution}` : ''}
              {item.resolvedBy ? ` (by ${item.resolvedBy}` : ''}
              {item.resolvedAt ? ` at ${item.resolvedAt.toISOString()})` : item.resolvedBy ? ')' : ''}
            </p>
          </>
        )}
      </div>

      <WorkItemActions id={item.id} kind={item.kind} open={item.status === 'OPEN'} />
    </div>
  )
}
