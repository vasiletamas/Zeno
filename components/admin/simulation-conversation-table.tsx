'use client'

import { useEffect, useState } from 'react'
import SimulationTranscriptViewer from './simulation-transcript-viewer'

interface SimConversation {
  id: string
  personaSlug: string
  scenarioType: string
  scenarioSlug: string | null
  status: string
  turnCount: number
  error: string | null
  score: number | null
  durationMs: number | null
}

export default function SimulationConversationTable({ runId }: { runId: string }) {
  const [conversations, setConversations] = useState<SimConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/simulation/runs/${runId}`)
      .then(r => r.json())
      .then(data => { setConversations(data.run?.conversations ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [runId])

  if (loading) return <p className="text-xs text-muted">Loading conversations...</p>
  if (conversations.length === 0) return <p className="text-xs text-muted">No conversations.</p>

  return (
    <div className="space-y-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-1 font-medium">Persona</th>
            <th className="pb-1 font-medium">Type</th>
            <th className="pb-1 font-medium">Scenario</th>
            <th className="pb-1 font-medium text-right">Turns</th>
            <th className="pb-1 font-medium text-right">Score</th>
            <th className="pb-1 font-medium text-right">Time</th>
            <th className="pb-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {conversations.map(c => (
            <tr key={c.id} onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                className="cursor-pointer border-t border-warm-border/50 hover:bg-cloud-100/30">
              <td className="py-1.5 text-night">{c.personaSlug}</td>
              <td className="py-1.5 text-muted">{c.scenarioType}</td>
              <td className="py-1.5 text-muted">{c.scenarioSlug ?? '\u2014'}</td>
              <td className="py-1.5 text-right text-night">{c.turnCount}</td>
              <td className="py-1.5 text-right text-night">{c.score !== null ? `${(c.score * 100).toFixed(0)}%` : '\u2014'}</td>
              <td className="py-1.5 text-right text-muted">{c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : '\u2014'}</td>
              <td className="py-1.5">
                <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                  c.status === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                  c.status === 'ABANDONED' ? 'bg-amber-100 text-amber-800' :
                  c.status === 'FAILED' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                }`}>{c.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selectedId && <SimulationTranscriptViewer conversationId={selectedId} />}
    </div>
  )
}
