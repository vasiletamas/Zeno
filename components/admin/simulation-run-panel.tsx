'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import SimulationConversationTable from './simulation-conversation-table'

interface SimulationRun {
  id: string
  status: string
  trigger: string
  totalScenarios: number
  completedCount: number
  failedCount: number
  avgScore: number | null
  errors: unknown[]
  startedAt: string
  completedAt: string | null
}

export default function SimulationRunPanel({ runs, simulationRunning }: { runs: SimulationRun[]; simulationRunning: boolean }) {
  const router = useRouter()
  const [running, setRunning] = useState(simulationRunning)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  async function handleRun(mode: 'all' | 'scripted' | 'freeform') {
    setRunning(true)
    try {
      await fetch('/api/admin/simulation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runScripted: mode !== 'freeform',
          runFreeform: mode !== 'scripted',
          freeformCount: 10,
          runBatchAfter: true,
        }),
      })
      setTimeout(() => { router.refresh(); setRunning(false) }, 10000)
    } catch { setRunning(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-night">Customer Simulation</h3>
        <div className="flex gap-2">
          {(['all', 'scripted', 'freeform'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => handleRun(mode)}
              disabled={running}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                mode === 'all'
                  ? 'bg-forest text-soft-white hover:bg-forest/90'
                  : 'border border-forest text-forest hover:bg-forest/10'
              }`}
            >
              {running && mode === 'all' ? 'Running...' : mode === 'all' ? 'Run All' : mode === 'scripted' ? 'Scripted Only' : 'Freeform Only'}
            </button>
          ))}
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="space-y-2">
          {runs.map(run => (
            <div key={run.id} className="rounded-lg border border-warm-border bg-white">
              <button
                onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-cloud-100/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    run.status === 'COMPLETED' ? 'bg-forest' : run.status === 'RUNNING' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                  }`} />
                  <span className="text-night font-medium">
                    {new Date(run.startedAt).toLocaleDateString('ro-RO')} {new Date(run.startedAt).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs text-muted">{run.trigger}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-forest">{run.completedCount} ok</span>
                  {run.failedCount > 0 && <span className="text-red-700">{run.failedCount} failed</span>}
                  {run.avgScore !== null && <span className="text-night">{(run.avgScore * 100).toFixed(0)}% avg</span>}
                  <span className="text-muted">{expandedRunId === run.id ? '\u25B2' : '\u25BC'}</span>
                </div>
              </button>
              {expandedRunId === run.id && (
                <div className="border-t border-warm-border p-3">
                  <SimulationConversationTable runId={run.id} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">No simulation runs yet. Click &quot;Run All&quot; to start.</p>
      )}
    </div>
  )
}
