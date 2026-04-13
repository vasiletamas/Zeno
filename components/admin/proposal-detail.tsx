'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ProposalFullData {
  id: string
  type: string
  title: string
  description: string
  diff: Record<string, unknown>
  evidence: { conversationIds: string[]; sampleSize: number; confidence: number }
  status: string
  adminNotes: string | null
  createdAt: string
}

interface ProposalDetailProps {
  proposal: ProposalFullData
}

export default function ProposalDetail({ proposal }: ProposalDetailProps) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleApprove() {
    setLoading(true)
    try {
      await fetch(`/api/admin/proposals/${proposal.id}/approve`, { method: 'POST' })
      router.push('/admin/proposals')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    try {
      await fetch(`/api/admin/proposals/${proposal.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      router.push('/admin/proposals')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/admin/proposals')}
        className="text-sm text-muted hover:text-night transition-colors"
      >
        &larr; Back to proposals
      </button>

      <div className="rounded-lg border border-warm-border bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-night">{proposal.title}</h3>
          <span className="rounded-full bg-cloud-100 px-2 py-0.5 text-xs font-medium text-night">
            {proposal.type.replace('_', ' ')}
          </span>
        </div>

        <p className="text-sm text-night whitespace-pre-wrap">{proposal.description}</p>

        {/* Evidence */}
        <div className="rounded-md bg-cloud-50 p-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Evidence</h4>
          <p className="text-sm text-night">
            Sample size: {proposal.evidence.sampleSize} conversations
            &mdash; Confidence: {Math.round(proposal.evidence.confidence * 100)}%
          </p>
        </div>

        {/* Diff */}
        <div className="rounded-md bg-cloud-50 p-4">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted mb-2">Proposed Change</h4>
          <pre className="text-xs text-night overflow-x-auto whitespace-pre-wrap font-mono">
            {JSON.stringify(proposal.diff, null, 2)}
          </pre>
        </div>

        {/* Actions (only for pending) */}
        {proposal.status === 'PENDING' && (
          <div className="space-y-3 border-t border-warm-border pt-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes (shown on rejection)..."
              className="w-full rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
              rows={2}
            />
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={loading}
                className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
              >
                Approve &amp; Apply
              </button>
              <button
                onClick={handleReject}
                disabled={loading}
                className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Rejection notes */}
        {proposal.status === 'REJECTED' && proposal.adminNotes && (
          <div className="rounded-md bg-red-50 p-4">
            <h4 className="text-xs font-medium uppercase tracking-wide text-red-700 mb-1">Rejection Notes</h4>
            <p className="text-sm text-red-700">{proposal.adminNotes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
