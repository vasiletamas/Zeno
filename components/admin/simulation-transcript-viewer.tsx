'use client'

import { useEffect, useState } from 'react'

interface TranscriptMessage {
  id: string; role: string; content: string; toolCalls: unknown; toolResults: unknown; createdAt: string
}

interface TranscriptData {
  simulation: { personaSlug: string; scenarioType: string; scenarioSlug: string | null; status: string; error: string | null }
  messages: TranscriptMessage[]
  score: { score: number } | null
}

export default function SimulationTranscriptViewer({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<TranscriptData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/simulation/conversations/${conversationId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [conversationId])

  if (loading) return <p className="text-xs text-muted py-2">Loading transcript...</p>
  if (!data) return <p className="text-xs text-red-700 py-2">Failed to load transcript.</p>

  return (
    <div className="rounded-lg border border-warm-border bg-cloud-100/30 p-4 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-night font-medium">{data.simulation.personaSlug} — {data.simulation.scenarioSlug ?? 'freeform'}</span>
        {data.score && <span className="text-forest font-medium">Score: {(data.score.score * 100).toFixed(0)}%</span>}
      </div>
      {data.simulation.error && (
        <div className="rounded bg-red-50 border border-red-200 p-2 text-xs text-red-700">{data.simulation.error}</div>
      )}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {data.messages.map(msg => (
          <div key={msg.id} className={`rounded-lg px-3 py-2 text-sm ${
            msg.role === 'user' ? 'ml-8 bg-forest/10 text-night' :
            msg.role === 'assistant' ? 'mr-8 bg-white border border-warm-border text-night' :
            'mx-4 bg-amber-50 text-amber-800 text-xs italic'
          }`}>
            <span className="text-xs font-medium text-muted block mb-0.5">
              {msg.role === 'user' ? 'Customer' : msg.role === 'assistant' ? 'Zeno' : 'System'}
            </span>
            {msg.content}
            {msg.toolCalls && <div className="mt-1 text-xs text-muted">Tools: {JSON.stringify(msg.toolCalls)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
