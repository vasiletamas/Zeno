'use client'

import { useEffect } from 'react'
import { useDebug } from './debug-provider'
import { TurnCard } from './turn-card'

const IS_DEV = process.env.NODE_ENV === 'development'

interface DebugDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DebugDrawerInner({ open, onOpenChange }: DebugDrawerProps) {
  const { enabled, setEnabled, turns, clearLog } = useDebug()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <aside
      data-testid="debug-drawer"
      className="fixed top-0 right-0 z-40 h-dvh w-[480px] max-w-[90vw] bg-white border-l border-black/10 shadow-xl flex flex-col"
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-black/10">
        <span className="text-xs font-mono font-semibold">Zeno Debug</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>enabled</span>
          </label>
          <button
            type="button"
            onClick={clearLog}
            className="text-[11px] font-mono underline hover:no-underline"
          >
            clear
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close debug drawer"
            className="text-lg leading-none px-1"
          >
            ×
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-2 space-y-2 bg-gray-50">
        {!enabled && (
          <p className="text-xs text-gray-500 p-2">
            Debug is off. Toggle it on, then send a message to capture a turn.
          </p>
        )}
        {enabled && turns.length === 0 && (
          <p className="text-xs text-gray-500 p-2">Waiting for a turn...</p>
        )}
        {turns.map((turn, i) => (
          <TurnCard key={turn.traceId} turn={turn} defaultOpen={i === 0} />
        ))}
      </div>
    </aside>
  )
}

/**
 * Slide-out debug drawer. Returns null in production builds — the inner
 * component (and its useDebug() / useEffect calls) is never reached, so
 * Next.js dead-code-eliminates it from the prod client bundle.
 */
export function DebugDrawer(props: DebugDrawerProps) {
  if (!IS_DEV || !props.open) return null
  return <DebugDrawerInner {...props} />
}
