'use client'

import { createContext, useCallback, useContext, useMemo, useReducer, useSyncExternalStore } from 'react'
import type { DebugEvent } from '@/lib/chat/debug'
import { EMPTY_STATE, debugReducer, type DebugTurn } from '@/lib/debug/reducer'

const STORAGE_KEY = 'zeno_debug'

const TOGGLE_EVENT = 'zeno-debug-toggle'

function readEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeEnabled(b: boolean): void {
  try {
    if (b) window.localStorage.setItem(STORAGE_KEY, '1')
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore quota / private-mode errors
  }
  window.dispatchEvent(new Event(TOGGLE_EVENT))
}

function subscribeEnabled(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('storage', callback) // cross-tab changes
  window.addEventListener(TOGGLE_EVENT, callback) // same-tab setEnabled calls
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(TOGGLE_EVENT, callback)
  }
}

function serverSnapshot(): boolean {
  return false
}

interface DebugContextValue {
  enabled: boolean
  setEnabled: (b: boolean) => void
  turns: DebugTurn[]
  onDebugEvent: (event: { event: string; data: Record<string, unknown> }) => void
  extraHeaders: Record<string, string>
  clearLog: () => void
  hydrate: (turns: DebugTurn[]) => void
}

const DebugContext = createContext<DebugContextValue | null>(null)

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const enabled = useSyncExternalStore(subscribeEnabled, readEnabled, serverSnapshot)
  const setEnabled = useCallback((b: boolean) => writeEnabled(b), [])

  const [state, dispatch] = useReducer(debugReducer, EMPTY_STATE)

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
  const hydrate = useCallback((turns: DebugTurn[]) => dispatch({ type: 'HYDRATE', turns }), [])

  const value = useMemo<DebugContextValue>(
    () => ({ enabled, setEnabled, turns: state.turns, onDebugEvent, extraHeaders, clearLog, hydrate }),
    [enabled, setEnabled, state.turns, onDebugEvent, extraHeaders, clearLog, hydrate],
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
    hydrate: () => undefined,
  }
}
