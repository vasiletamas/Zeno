'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface MessageData {
  id: string
  role: string
  content: string
  createdAt: string
}

interface TurnTraceData {
  id: string
  messageIndex: number
  phases: unknown
  inputTokens: number | null
  outputTokens: number | null
  cost: number | null
  latencyMs: number | null
  provider: string | null
  model: string | null
}

interface ConversationViewerProps {
  messages: MessageData[]
  turnTraces: TurnTraceData[]
}

function roleLabel(role: string): string {
  switch (role) {
    case 'assistant': return 'Zeno'
    case 'user': return 'Client'
    case 'system': return 'System'
    case 'tool': return 'Tool'
    default: return role
  }
}

function roleBg(role: string): string {
  switch (role) {
    case 'assistant': return 'bg-linen'
    case 'user': return 'bg-forest/5'
    case 'system': return 'bg-muted/5'
    case 'tool': return 'bg-info/5'
    default: return 'bg-white'
  }
}

export default function ConversationViewer({ messages, turnTraces }: ConversationViewerProps) {
  const [expandedTrace, setExpandedTrace] = useState<string | null>(null)

  // Index traces by messageIndex for quick lookup
  const traceByIndex = new Map<number, TurnTraceData>()
  for (const trace of turnTraces) {
    traceByIndex.set(trace.messageIndex, trace)
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((msg, index) => {
        const trace = traceByIndex.get(index)
        return (
          <div key={msg.id}>
            {/* Message */}
            <div className={`rounded-lg p-4 ${roleBg(msg.role)}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  {roleLabel(msg.role)}
                </span>
                <span className="text-xs text-muted">
                  {new Date(msg.createdAt).toLocaleString('ro-RO')}
                </span>
              </div>
              <p className="text-sm text-night whitespace-pre-wrap">{msg.content}</p>
            </div>

            {/* Turn trace (if available) */}
            {trace && (
              <div className="ml-4 mt-1">
                <button
                  onClick={() =>
                    setExpandedTrace(expandedTrace === trace.id ? null : trace.id)
                  }
                  className="flex items-center gap-1 text-xs text-muted hover:text-night transition-colors"
                >
                  {expandedTrace === trace.id ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  Trace #{index}
                  {trace.latencyMs != null && ` — ${trace.latencyMs}ms`}
                  {trace.cost != null && ` — $${trace.cost.toFixed(4)}`}
                </button>

                {expandedTrace === trace.id && (
                  <div className="mt-2 rounded-md border border-warm-border bg-white p-3 text-xs">
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {trace.provider && (
                        <div>
                          <dt className="text-muted">Provider</dt>
                          <dd className="text-night">{trace.provider}</dd>
                        </div>
                      )}
                      {trace.model && (
                        <div>
                          <dt className="text-muted">Model</dt>
                          <dd className="text-night">{trace.model}</dd>
                        </div>
                      )}
                      {trace.inputTokens != null && (
                        <div>
                          <dt className="text-muted">Input Tokens</dt>
                          <dd className="text-night">{trace.inputTokens}</dd>
                        </div>
                      )}
                      {trace.outputTokens != null && (
                        <div>
                          <dt className="text-muted">Output Tokens</dt>
                          <dd className="text-night">{trace.outputTokens}</dd>
                        </div>
                      )}
                      {trace.latencyMs != null && (
                        <div>
                          <dt className="text-muted">Latency</dt>
                          <dd className="text-night">{trace.latencyMs}ms</dd>
                        </div>
                      )}
                      {trace.cost != null && (
                        <div>
                          <dt className="text-muted">Cost</dt>
                          <dd className="text-night">${trace.cost.toFixed(4)}</dd>
                        </div>
                      )}
                    </dl>

                    {/* Phases */}
                    {trace.phases != null && (
                      <div className="mt-3">
                        <p className="mb-1 font-medium text-muted">Phases</p>
                        <pre className="max-h-[200px] overflow-y-auto rounded-md bg-linen p-2 text-xs text-night">
                          {JSON.stringify(trace.phases, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {messages.length === 0 && (
        <p className="rounded-lg border border-warm-border bg-white p-6 text-center text-sm text-muted">
          Nu exista mesaje.
        </p>
      )}
    </div>
  )
}
