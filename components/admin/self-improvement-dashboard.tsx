'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DashboardData {
  totalScored: number
  avgScore7d: number
  scoreCount7d: number
  proposals: { pending: number; approved: number; rejected: number }
  topSkillPacks: { skillPackSlugs: string[]; _avg: { score: number }; _count: { _all: number } }[]
  lowKnowledge: { id: string; category: string; trigger: string; successRate: number; sampleSize: number }[]
  activeRegressions: { id: string; title: string; description: string; createdAt: string }[]
  batchRunning: boolean
}

interface SelfImprovementDashboardProps {
  data: DashboardData
}

export default function SelfImprovementDashboard({ data }: SelfImprovementDashboardProps) {
  const router = useRouter()
  const [running, setRunning] = useState(data.batchRunning)

  async function handleRunBatch() {
    setRunning(true)
    try {
      await fetch('/api/admin/self-improvement', { method: 'POST' })
      setTimeout(() => {
        router.refresh()
        setRunning(false)
      }, 5000)
    } catch {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Total Scored" value={String(data.totalScored)} />
        <StatCard label="7-Day Avg Score" value={`${(data.avgScore7d * 100).toFixed(1)}%`} sub={`${data.scoreCount7d} conversations`} />
        <StatCard label="Pending Proposals" value={String(data.proposals.pending)} />
        <StatCard
          label="Batch Status"
          value={running ? 'Running...' : 'Idle'}
          action={
            <button
              onClick={handleRunBatch}
              disabled={running}
              className="mt-2 rounded-md bg-forest px-3 py-1 text-xs font-medium text-soft-white hover:bg-forest/90 transition-colors disabled:opacity-50"
            >
              Run Now
            </button>
          }
        />
      </div>

      {/* Proposals summary */}
      <div className="rounded-lg border border-warm-border bg-white p-4">
        <h3 className="text-sm font-medium text-night mb-3">Proposals Summary</h3>
        <div className="flex gap-6 text-sm">
          <span className="text-amber-700">Pending: {data.proposals.pending}</span>
          <span className="text-forest">Approved: {data.proposals.approved}</span>
          <span className="text-red-700">Rejected: {data.proposals.rejected}</span>
        </div>
      </div>

      {/* Top skill packs */}
      <div className="rounded-lg border border-warm-border bg-white p-4">
        <h3 className="text-sm font-medium text-night mb-3">Top Performing Skill Packs</h3>
        {data.topSkillPacks.length > 0 ? (
          <div className="space-y-2">
            {data.topSkillPacks.map((sp, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <code className="rounded bg-cloud-100 px-1.5 py-0.5 font-mono text-xs">
                  {sp.skillPackSlugs.join(' + ') || '(none)'}
                </code>
                <span className="text-night">
                  {((sp._avg.score ?? 0) * 100).toFixed(1)}% avg ({sp._count._all} convs)
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No data yet.</p>
        )}
      </div>

      {/* Low knowledge */}
      <div className="rounded-lg border border-warm-border bg-white p-4">
        <h3 className="text-sm font-medium text-night mb-3">Lowest Performing Knowledge</h3>
        {data.lowKnowledge.length > 0 ? (
          <div className="space-y-2">
            {data.lowKnowledge.map((k) => (
              <div key={k.id} className="flex items-center justify-between text-sm">
                <span className="text-night">{k.category}: {k.trigger}</span>
                <span className="text-red-700">
                  {(k.successRate * 100).toFixed(1)}% ({k.sampleSize} samples)
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No data yet.</p>
        )}
      </div>

      {/* Regressions */}
      {data.activeRegressions.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-medium text-red-700 mb-3">Active Regressions</h3>
          <div className="space-y-2">
            {data.activeRegressions.map((r) => (
              <div key={r.id} className="text-sm text-red-700">
                <strong>{r.title}</strong>
                <p className="text-xs">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, action }: { label: string; value: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-warm-border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-medium text-night">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {action}
    </div>
  )
}
