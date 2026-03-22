'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface PolicyRow {
  id: string
  status: string
  allianzPolicyNumber: string | null
  premiumAnnual: number
  paymentFrequency: string | null
  createdAt: string
  customer: { name: string | null; email: string | null }
  quote: {
    application: {
      product: { name: unknown } | null
    }
  }
}

interface PolicyTableProps {
  policies: PolicyRow[]
}

function getProductName(name: unknown): string {
  if (!name) return '-'
  if (typeof name === 'string') return name
  if (typeof name === 'object' && name !== null) {
    const n = name as Record<string, string>
    return n.ro || n.en || Object.values(n)[0] || '-'
  }
  return '-'
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-sage/10 text-sage',
    SUBMITTED: 'bg-info/10 text-info',
    PENDING_SUBMISSION: 'bg-sand/10 text-sand',
    CANCELLED: 'bg-error/10 text-error',
    EXPIRED: 'bg-muted/10 text-muted',
  }
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-muted/10 text-muted'}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

export default function PolicyTable({ policies }: PolicyTableProps) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [activateId, setActivateId] = useState<string | null>(null)
  const [allianzNumber, setAllianzNumber] = useState('')

  async function updateStatus(policyId: string, status: string, allianzPolicyNumber?: string) {
    setLoadingId(policyId)
    try {
      await fetch(`/api/admin/policies/${policyId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, allianzPolicyNumber }),
      })
      router.refresh()
    } finally {
      setLoadingId(null)
      setActivateId(null)
      setAllianzNumber('')
    }
  }

  if (policies.length === 0) {
    return (
      <p className="rounded-lg border border-warm-border bg-white p-6 text-center text-sm text-muted">
        Nu exista polite.
      </p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-warm-border bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-warm-border bg-linen/50">
              <th className="px-4 py-3 font-medium text-muted">Client</th>
              <th className="px-4 py-3 font-medium text-muted">Produs</th>
              <th className="px-4 py-3 font-medium text-muted">Status</th>
              <th className="px-4 py-3 font-medium text-muted">Nr. Allianz</th>
              <th className="px-4 py-3 font-medium text-muted">Prima/an</th>
              <th className="px-4 py-3 font-medium text-muted">Data</th>
              <th className="px-4 py-3 font-medium text-muted">Actiuni</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => (
              <tr
                key={policy.id}
                className="border-b border-warm-border last:border-0 hover:bg-linen/30 transition-colors"
              >
                <td className="px-4 py-3 text-night">
                  {policy.customer.name ?? policy.customer.email ?? '-'}
                </td>
                <td className="px-4 py-3 text-night">
                  {getProductName(policy.quote.application.product?.name)}
                </td>
                <td className="px-4 py-3">{statusBadge(policy.status)}</td>
                <td className="px-4 py-3 text-night">
                  {policy.allianzPolicyNumber ?? '-'}
                </td>
                <td className="px-4 py-3 text-night">{policy.premiumAnnual} RON</td>
                <td className="px-4 py-3 text-muted">
                  {new Date(policy.createdAt).toLocaleDateString('ro-RO')}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {policy.status === 'PENDING_SUBMISSION' && (
                      <button
                        onClick={() => updateStatus(policy.id, 'SUBMITTED')}
                        disabled={loadingId === policy.id}
                        className="rounded-md border border-sage px-2 py-1 text-xs text-sage hover:bg-sage/10 disabled:opacity-50"
                      >
                        Mark Submitted
                      </button>
                    )}
                    {policy.status === 'SUBMITTED' && (
                      <button
                        onClick={() => setActivateId(policy.id)}
                        disabled={loadingId === policy.id}
                        className="rounded-md border border-forest px-2 py-1 text-xs text-forest hover:bg-forest/10 disabled:opacity-50"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Activate modal */}
      {activateId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/40">
          <div className="mx-4 w-full max-w-[400px] rounded-lg border border-warm-border bg-white p-6">
            <h3 className="mb-4 text-lg font-medium text-night">Activeaza polita</h3>
            <label className="mb-1 block text-sm font-medium text-night">
              Numar polita Allianz
            </label>
            <input
              type="text"
              value={allianzNumber}
              onChange={(e) => setAllianzNumber(e.target.value)}
              className="mb-4 w-full rounded-md border border-warm-border bg-soft-white px-3 py-2 text-sm text-night outline-none focus:border-sage focus:ring-1 focus:ring-sage"
              placeholder="e.g. ALZ-2026-123456"
            />
            <div className="flex gap-3">
              <button
                onClick={() => updateStatus(activateId, 'ACTIVE', allianzNumber)}
                disabled={loadingId === activateId || !allianzNumber}
                className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-linen hover:bg-sage transition-colors disabled:opacity-50"
              >
                {loadingId === activateId ? 'Se activeaza...' : 'Activeaza'}
              </button>
              <button
                onClick={() => { setActivateId(null); setAllianzNumber('') }}
                className="rounded-md border border-warm-border px-4 py-2 text-sm text-muted hover:bg-linen transition-colors"
              >
                Anuleaza
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
