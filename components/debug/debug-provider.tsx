'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import type { DebugEvent } from '@/lib/chat/debug'
import { EMPTY_STATE, reduceDebugEvent, type DebugState, type DebugTurn } from '@/lib/debug/reducer'

const STORAGE_KEY = 'zeno_debug'

interface DebugContextValue {
  enabled: boolean
  setEnabled: (b: boolean) => void
  turns: DebugTurn[]
  onDebugEvent: (event: { event: string; data: Record<string, unknown> }) => void
  extraHeaders: Record<string, string>
  clearLog: () => void
}

const DebugContext = createContext<DebugContextValue | null>(null)

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(false)

  // Hydrate enabled from localStorage (client-only)
  useEffect(() => {
    try {
      setEnabledState(window.localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // ignore
    }
  }, [])

  const setEnabled = useCallback((b: boolean) => {
    setEnabledState(b)
    try {
      if (b) window.localStorage.setItem(STORAGE_KEY, '1')
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const [state, dispatch] = useReducer(
    (s: DebugState, e: DebugEvent | { type: 'CLEAR' }) =>
      'type' in e ? EMPTY_STATE : reduceDebugEvent(s, e),
    EMPTY_STATE,
  )

  const onDebugEvent = useCallback(
    (event: { event: string; data: Record<string, unknown> }) => {
      // Cast narrows to DebugEvent — the orchestrator guarantees this shape
      dispatch(event as unknown as DebugEvent)
    },
    [],
  )

  const extraHeaders = useMemo<Record<string, string>>(
    () => (enabled ? { 'x-zeno-debug': '1' } : ({} as Record<string, string>)),
    [enabled],
  )

  const clearLog = useCallback(() => dispatch({ type: 'CLEAR' }), [])

  const value = useMemo<DebugContextValue>(
    () => ({ enabled, setEnabled, turns: state.turns, onDebugEvent, extraHeaders, clearLog }),
    [enabled, setEnabled, state.turns, onDebugEvent, extraHeaders, clearLog],
  )

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
}

/**
 * Returns the debug context, or a no-op fallback when not wrapped in a
 * DebugProvider. The fallback is what production builds get, since the
 * provider is only mounted in dev.
 */
export function useDebug(): DebugContextValue {
  const ctx = useContext(DebugContext)
  if (ctx) return ctx
  return {
    enabled: false,
    setEnabled: () => undefined,
    turns: [],
    onDebugEvent: () => undefined,
    extraHeaders: {},
    clearLog: () => undefined,
  }
}
