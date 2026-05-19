/**
 * Dev-mode debug instrumentation for the chat orchestrator.
 *
 * Every debug SSE event passes through debugYield(). In production builds
 * (NODE_ENV !== 'development') the helper is a no-op, so no debug payloads
 * are ever serialized into the response. The `enabled` flag adds a per-
 * request opt-in driven by the `x-zeno-debug: 1` client header.
 */

import type { SSEEvent } from './stream-handler'
import type { ReasoningGateInput, ReasoningGateOutput } from './reasoning-gate'
import type { PromptSections } from './prompt-builder'

// ==============================================
// DEBUG EVENT PAYLOADS
// ==============================================

export interface DebugTurnStartPayload {
  traceId: string
  conversationId: string
  messageIndex: number
  userMessage: string
  language: 'en' | 'ro'
}

export interface DebugGatePayload {
  traceId: string
  skipped: boolean
  reason?: 'fast_path' | 'synthetic'
  input?: ReasoningGateInput
  output?: ReasoningGateOutput
  durationMs: number
}

export interface DebugPromptPayload {
  traceId: string
  sections: PromptSections
  sectionSizes: Record<string, number>
  includedSections: string[]
  excludedSections: string[]
  gateActive: boolean
  stablePrefix: string | null
  dynamicSuffix: string | null
  totalChars: number
}

export interface DebugToolCallPayload {
  traceId: string
  round: number
  toolCallId: string
  name: string
  args: Record<string, unknown>
  partition: 'readOnly' | 'writing' | 'background'
}

export interface DebugToolResultPayload {
  traceId: string
  toolCallId: string
  success: boolean
  durationMs: number
  cached: boolean
  data?: unknown
  error?: string
  uiAction?: Record<string, unknown>
  transition?: Record<string, unknown>
}

export interface DebugTurnEndPayload {
  traceId: string
  phases: Record<string, unknown>
  totalInputTokens: number
  totalOutputTokens: number
  cost: number | null
  latencyMs: number
  anomalies: unknown[]
}

// ==============================================
// DEBUG EVENT UNION (the wire format)
// ==============================================

export type DebugEvent =
  | { event: 'debug:turn_start'; data: DebugTurnStartPayload }
  | { event: 'debug:gate'; data: DebugGatePayload }
  | { event: 'debug:prompt'; data: DebugPromptPayload }
  | { event: 'debug:tool_call'; data: DebugToolCallPayload }
  | { event: 'debug:tool_result'; data: DebugToolResultPayload }
  | { event: 'debug:turn_end'; data: DebugTurnEndPayload }

// ==============================================
// THE GATING HELPER
// ==============================================

/**
 * Yields the given debug event only when running in development AND the per-
 * request enabled flag is true. In every other case it yields nothing.
 *
 * This is the single chokepoint for all debug emissions in the orchestrator.
 */
export function* debugYield(
  isDev: boolean,
  enabled: boolean,
  event: DebugEvent,
): Generator<SSEEvent> {
  // Typed DebugEvent payloads are structurally compatible with SSEEvent's
  // generic Record<string, unknown> data field, but TS can't widen typed
  // interfaces to an index signature automatically — hence the cast.
  if (isDev && enabled) yield event as unknown as SSEEvent
}

// ==============================================
// MODULE-LEVEL DEV FLAG
// ==============================================

/** True iff the server is running with NODE_ENV === 'development'. */
export const IS_DEV = process.env.NODE_ENV === 'development'
