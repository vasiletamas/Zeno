'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const DECISIONS_BY_KIND: Record<string, { decision: string; label: string; destructive?: boolean }[]> = {
  REFERRAL: [
    { decision: 'approve', label: 'Approve — resume quote' },
    { decision: 'reject', label: 'Reject — terminate application', destructive: true },
  ],
  ESCALATION: [
    { decision: 'resolve', label: 'Resolve' },
    { decision: 'dismiss', label: 'Dismiss', destructive: true },
  ],
  DOCUMENT_REVIEW: [
    { decision: 'resolve', label: 'Resolve' },
    { decision: 'dismiss', label: 'Dismiss', destructive: true },
  ],
  ALERT_FLAG: [
    { decision: 'resolve', label: 'Resolve' },
    { decision: 'dismiss', label: 'Dismiss', destructive: true },
  ],
  // E3 (erratum 8): GDPR approvals run the gateway commits
  // (approve_erasure executes the retention-driven job; approve_export
  // compiles and stores the bundle) — dismiss closes without action.
  GDPR_ERASURE: [
    { decision: 'approve', label: 'Approve — execute erasure', destructive: true },
    { decision: 'dismiss', label: 'Dismiss' },
  ],
  GDPR_EXPORT: [
    { decision: 'approve', label: 'Approve — compile export bundle' },
    { decision: 'dismiss', label: 'Dismiss', destructive: true },
  ],
}

export default function WorkItemActions({ id, kind, open }: { id: string; kind: string; open: boolean }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actions = DECISIONS_BY_KIND[kind]

  if (!open) return null
  if (!actions) {
    return <p className="text-sm text-muted">No resolution actions are defined for this kind.</p>
  }

  async function submit(decision: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/work-items/${id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, note: note || undefined }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Request failed')
      return
    }
    router.refresh()
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution note (recorded on the item; on reject it becomes the underwriter reason)"
        className="min-h-20 rounded-md border border-warm-border bg-soft-white p-3 text-sm text-night"
      />
      <div className="flex gap-2">
        {actions.map((a) => (
          <button
            key={a.decision}
            onClick={() => submit(a.decision)}
            disabled={busy}
            className={`
              rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50
              ${a.destructive ? 'border border-red-300 text-red-700 hover:bg-red-50' : 'bg-forest text-soft-white hover:opacity-90'}
            `}
          >
            {a.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}
