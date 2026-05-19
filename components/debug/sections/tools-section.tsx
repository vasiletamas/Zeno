'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'

export function ToolsSection({
  toolCalls,
}: {
  toolCalls: DebugTurn['toolCalls']
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (toolCalls.length === 0)
    return <p className="text-xs text-gray-500">No tool calls.</p>

  return (
    <ul className="space-y-1">
      {toolCalls.map((tc) => {
        const open = expandedId === tc.toolCallId
        const status =
          tc.result?.success === true
            ? 'ok'
            : tc.result?.success === false
              ? 'fail'
              : 'pending'
        const color =
          status === 'ok'
            ? 'bg-emerald-100 text-emerald-700'
            : status === 'fail'
              ? 'bg-rose-100 text-rose-700'
              : 'bg-gray-100 text-gray-600'
        return (
          <li
            key={tc.toolCallId}
            className="border border-black/5 rounded text-xs"
          >
            <button
              type="button"
              onClick={() => setExpandedId(open ? null : tc.toolCallId)}
              className="w-full flex items-center justify-between gap-2 px-2 py-1 font-mono text-left hover:bg-gray-50"
            >
              <span>{tc.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">{tc.partition}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${color}`}>
                  {status}
                </span>
              </span>
            </button>
            {open && (
              <div className="px-2 py-1 space-y-2 bg-gray-50">
                <div>
                  <p className="font-mono text-[10px] text-gray-500">args</p>
                  <pre className="text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(tc.args, null, 2)}
                  </pre>
                </div>
                {tc.result && (
                  <div>
                    <p className="font-mono text-[10px] text-gray-500">
                      result ({tc.result.durationMs}ms)
                    </p>
                    <pre className="text-[11px] whitespace-pre-wrap">
                      {JSON.stringify(
                        tc.result.data ?? tc.result.error,
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
