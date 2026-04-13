'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ABTestData {
  id: string
  name: string
  skillPackSlugA: string
  skillPackSlugB: string
  splitRatio: number
  isActive: boolean
  conversationsA: number
  conversationsB: number
  startedAt: string
  endedAt: string | null
}

interface ABTestTableProps {
  tests: ABTestData[]
  skillPackSlugs: string[]
}

export default function ABTestTable({ tests, skillPackSlugs }: ABTestTableProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [ending, setEnding] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', skillPackSlugA: '', skillPackSlugB: '', splitRatio: '0.5' })

  async function handleCreate() {
    setCreating(true)
    try {
      await fetch('/api/admin/ab-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          splitRatio: parseFloat(form.splitRatio),
        }),
      })
      setForm({ name: '', skillPackSlugA: '', skillPackSlugB: '', splitRatio: '0.5' })
      router.refresh()
    } finally {
      setCreating(false)
    }
  }

  async function handleEnd(id: string) {
    setEnding(id)
    try {
      await fetch(`/api/admin/ab-tests/${id}/end`, { method: 'POST' })
      router.refresh()
    } finally {
      setEnding(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="rounded-lg border border-warm-border bg-white p-4 space-y-3">
        <h3 className="text-sm font-medium text-night">Create A/B Test</h3>
        <div className="grid grid-cols-2 gap-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Test name"
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          />
          <input
            value={form.splitRatio}
            onChange={(e) => setForm({ ...form, splitRatio: e.target.value })}
            placeholder="Split ratio (0-1)"
            type="number"
            min="0"
            max="1"
            step="0.1"
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          />
          <select
            value={form.skillPackSlugA}
            onChange={(e) => setForm({ ...form, skillPackSlugA: e.target.value })}
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          >
            <option value="">Control (A)</option>
            {skillPackSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={form.skillPackSlugB}
            onChange={(e) => setForm({ ...form, skillPackSlugB: e.target.value })}
            className="rounded-md border border-warm-border px-3 py-2 text-sm focus:border-zeno-500 focus:outline-none"
          >
            <option value="">Variant (B)</option>
            {skillPackSlugs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating || !form.name || !form.skillPackSlugA || !form.skillPackSlugB}
          className="rounded-md bg-forest px-4 py-2 text-sm font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
        >
          Create Test
        </button>
      </div>

      {/* Tests table */}
      <div className="overflow-hidden rounded-lg border border-warm-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-border bg-cloud-50">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">A vs B</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Split</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Conversations</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-warm-border">
            {tests.map((t) => (
              <tr key={t.id} className="hover:bg-cloud-50 transition-colors">
                <td className="px-4 py-3 text-night font-medium">{t.name}</td>
                <td className="px-4 py-3 text-xs">
                  <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono">{t.skillPackSlugA}</code>
                  {' vs '}
                  <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono">{t.skillPackSlugB}</code>
                </td>
                <td className="px-4 py-3 text-night">{Math.round(t.splitRatio * 100)}% B</td>
                <td className="px-4 py-3 text-muted text-xs">A: {t.conversationsA} / B: {t.conversationsB}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${t.isActive ? 'bg-sage/10 text-forest' : 'bg-cloud-100 text-muted'}`}>
                    {t.isActive ? 'Active' : 'Ended'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {t.isActive && (
                    <button
                      onClick={() => handleEnd(t.id)}
                      disabled={ending === t.id}
                      className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
                    >
                      End
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  No A/B tests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
