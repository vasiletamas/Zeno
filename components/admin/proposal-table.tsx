'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ProposalData {
  id: string
  type: string
  title: string
  status: string
  evidence: { sampleSize: number; confidence: number }
  createdAt: string
}

interface ProposalTableProps {
  proposals: ProposalData[]
}

type StatusFilter = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'

const STATUS_TABS: StatusFilter[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED']

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-sage/10 text-forest',
  REJECTED: 'bg-red-100 text-red-700',
}

const TYPE_BADGE: Record<string, string> = {
  KNOWLEDGE_CREATE: 'bg-zeno-500/10 text-zeno-600',
  KNOWLEDGE_UPDATE: 'bg-blue-100 text-blue-700',
  SKILLPACK_UPDATE: 'bg-purple-100 text-purple-700',
  INSIGHT: 'bg-cloud-100 text-night',
}

export default function ProposalTable({ proposals }: ProposalTableProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<StatusFilter>('ALL')

  const visible =
    filter === 'ALL' ? proposals : proposals.filter((p) => p.status === filter)

  return (
    <div>
      {/* Status filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-warm-border bg-cloud-50 p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === tab
                ? 'bg-white text-night shadow-sm'
                : 'text-muted hover:text-night'
            }`}
          >
            {tab === 'ALL' ? `All (${proposals.length})` : `${tab} (${proposals.filter((p) => p.status === tab).length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-warm-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-border bg-cloud-50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Title</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Evidence</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Created</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-border">
            {visible.map((p) => (
              <tr key={p.id} className="hover:bg-cloud-50 transition-colors">
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[p.type] ?? 'bg-cloud-100 text-night'}`}>
                    {p.type.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-night font-medium max-w-xs truncate">{p.title}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[p.status] ?? ''}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted text-xs">
                  {p.evidence.sampleSize} convs, {Math.round(p.evidence.confidence * 100)}%
                </td>
                <td className="px-4 py-3 text-muted text-xs">
                  {new Date(p.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => router.push(`/admin/proposals?detail=${p.id}`)}
                    className="rounded-md border border-warm-border px-3 py-1 text-xs font-medium text-night hover:bg-linen transition-colors"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  No proposals found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
