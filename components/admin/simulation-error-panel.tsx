'use client'

interface SimulationError { runId: string; runDate: string; errors: string[] }

export default function SimulationErrorPanel({ errorsByRun }: { errorsByRun: SimulationError[] }) {
  const allErrors = errorsByRun.flatMap(r => r.errors.map(e => ({ runDate: r.runDate, error: e })))
  if (allErrors.length === 0) return <p className="text-sm text-muted">No simulation errors.</p>

  const grouped = new Map<string, { count: number; samples: string[] }>()
  for (const { error } of allErrors) {
    const key = error.includes(']') ? error.slice(1, error.indexOf(']')) : 'other'
    const existing = grouped.get(key) ?? { count: 0, samples: [] }
    existing.count++
    if (existing.samples.length < 3) existing.samples.push(error)
    grouped.set(key, existing)
  }

  return (
    <div className="space-y-2">
      {Array.from(grouped.entries()).map(([type, data]) => (
        <div key={type} className="rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-red-700">{type}</span>
            <span className="text-xs text-red-600">{data.count}x</span>
          </div>
          {data.samples.map((s, i) => <p key={i} className="text-xs text-red-600 truncate">{s}</p>)}
        </div>
      ))}
    </div>
  )
}
