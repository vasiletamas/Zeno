'use client'

import type { DebugTurn } from '@/lib/debug/reducer'

/**
 * Shows the tool-narration detector result for the turn (Pathology 1 guard):
 * whether Zeno leaked tool mechanics / asked permission for a lookup, and
 * which phrases tripped it.
 */
export function ToolNarrationSection({
  toolNarration,
}: {
  toolNarration: DebugTurn['toolNarration']
}) {
  if (!toolNarration) {
    return <p className="text-xs text-gray-500">Not evaluated.</p>
  }

  if (toolNarration.clean) {
    return (
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-emerald-100 text-emerald-700">
        clean — no tool narration
      </span>
    )
  }

  return (
    <div className="space-y-1">
      <span className="inline-block rounded px-1.5 py-0.5 text-[10px] bg-rose-100 text-rose-700">
        {toolNarration.violations.length} violation
        {toolNarration.violations.length === 1 ? '' : 's'}
      </span>
      <ul className="space-y-1">
        {toolNarration.violations.map((v, i) => (
          <li
            key={i}
            className="border border-rose-200 rounded text-xs px-2 py-1 font-mono flex items-center justify-between gap-2"
          >
            <span className="text-rose-700">“{v.matchedPhrase}”</span>
            <span className="text-[10px] text-gray-500">{v.category}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
