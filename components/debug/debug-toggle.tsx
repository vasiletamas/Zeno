'use client'

import { useDebug } from './debug-provider'

interface DebugToggleProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DebugToggle({ open, onOpenChange }: DebugToggleProps) {
  // Build-time dead-code elimination guard. Next.js inlines this constant.
  if (process.env.NODE_ENV !== 'development') return null

  const { enabled, turns } = useDebug()

  return (
    <button
      type="button"
      data-testid="debug-toggle"
      onClick={() => onOpenChange(!open)}
      title={enabled ? 'Debug console (on)' : 'Debug console (off)'}
      className="fixed bottom-4 right-4 z-50 flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white px-3 text-xs font-mono shadow-md hover:shadow-lg transition-shadow"
    >
      <span
        className={`h-2 w-2 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-gray-400'}`}
      />
      <span>debug</span>
      {enabled && turns.length > 0 && (
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">{turns.length}</span>
      )}
    </button>
  )
}
