'use client'

import { useState } from 'react'
import type { DebugTurn } from '@/lib/debug/reducer'

export function PromptSection({ prompt }: { prompt: DebugTurn['prompt'] }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  if (!prompt) return <p className="text-xs text-gray-500">No prompt data yet.</p>

  const sectionEntries = Object.entries(prompt.sections).filter(
    ([, v]) => v != null && v !== '',
  )

  return (
    <div className="space-y-2 text-xs">
      <p className="font-mono">total: {prompt.totalChars} chars</p>
      <ul className="space-y-1">
        {sectionEntries.map(([key, value]) => {
          const size = prompt.sectionSizes[key] ?? (value as string).length
          const included = prompt.includedSections.includes(key)
          const open = expandedKey === key
          return (
            <li key={key} className="border border-black/5 rounded">
              <button
                type="button"
                onClick={() => setExpandedKey(open ? null : key)}
                className="w-full flex justify-between items-center px-2 py-1 font-mono text-left hover:bg-gray-50"
              >
                <span className={included ? '' : 'opacity-50 line-through'}>
                  {key}
                </span>
                <span className="text-[10px] text-gray-500">{size}</span>
              </button>
              {open && (
                <pre className="px-2 py-1 text-[11px] whitespace-pre-wrap bg-gray-50 max-h-64 overflow-auto">
                  {String(value)}
                </pre>
              )}
            </li>
          )
        })}
      </ul>
      {prompt.stablePrefix && (
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(prompt.stablePrefix ?? '')}
          className="text-[10px] underline"
        >
          Copy stablePrefix
        </button>
      )}
    </div>
  )
}
