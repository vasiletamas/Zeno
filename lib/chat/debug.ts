/**
 * Dev-mode debug instrumentation for the chat orchestrator.
 *
 * Every debug SSE event passes through debugYield(). In production builds
 * (NODE_ENV !== 'development') the helper is a no-op, so no debug payloads
 * are ever serialized into the response. The `enabled` flag adds a per-
 * request opt-in driven by the `x-zeno-debug: 1` client header.
 */

import type { SSEEvent } from './stream-handler'
import type { PromptSections } from './prompt-builder'
import type { ToolNarrationResult } from './tool-narration-detector'
import type { TurnContextCustomer } from './turn-context'
import type { RawCustomerInsight } from './context-loaders'
import type { DerivedStateV3, ExposedActions } from '@/lib/engines/domain-types'
import { calculateAge } from './age'
import { writeDebugEvent } from './debug-persistence'

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
  durationMs: number
  /**
   * The phase derived this turn (replaces the old reasoning-gate output).
   */
  derivedPhase?: string
  /**
   * True when state derivation failed this turn and the orchestrator fell
   * back to the DISCOVERY section set.
   */
  error?: boolean
  /**
   * The full DerivedStateV3 snapshot for this turn (deriveAndExpose output),
   * surfaced to the debug drawer's "State" panel. Null when derivation failed.
   */
  derivedState?: DerivedStateV3 | null
  /**
   * The exposure computed this turn: available + blocked actions with reason
   * codes. Part of the per-turn legality snapshot (T14.D2).
   */
  actions?: ExposedActions
  /**
   * Version stamp of the derive-and-expose rule set that produced this
   * snapshot, for recompute-and-diff replay (T14.D2).
   */
  engineVersion?: string
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
  /**
   * Structured confirmation payload (subsystem C). Populated when the tool's
   * sideEffect category produced a customer-facing '✓ Label: Value' line.
   */
  confirmation?: {
    category: 'save' | 'lifecycle' | 'consent' | 'quote'
    label: string
    value: string
    provenance?: string
    timestamp: string
  }
}

export interface DebugToolNarrationPayload extends ToolNarrationResult {
  traceId: string
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

export interface DebugIdentityMemoryEntry {
  id: string
  kind: string
  text: string
  createdAt: string
}

export interface DebugIdentityPayload {
  traceId: string
  conversationId: string
  messageIndex: number
  identity: {
    cookieId: string
    isAnonymous: boolean
  }
  customer: {
    name: string | null
    age: number | null
    language: string
  }
  consent: {
    gdprConsentAt: string | null
    gdprConsentScope: string | null
    aiDisclosureAcknowledgedAt: string | null
  }
  conversation: {
    productId: string | null
    productCode: string | null
    productName: string | null
    candidateProductId: string | null
    candidateConfidence: number | null
    candidateSetAt: string | null
  }
  memory: DebugIdentityMemoryEntry[]
}

// ==============================================
// DEBUG EVENT UNION (the wire format)
// ==============================================

export type DebugEvent =
  | { event: 'debug:turn_start'; data: DebugTurnStartPayload }
  | { event: 'debug:identity'; data: DebugIdentityPayload }
  | { event: 'debug:gate'; data: DebugGatePayload }
  | { event: 'debug:prompt'; data: DebugPromptPayload }
  | { event: 'debug:tool_call'; data: DebugToolCallPayload }
  | { event: 'debug:tool_result'; data: DebugToolResultPayload }
  | { event: 'debug:tool_narration'; data: DebugToolNarrationPayload }
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
  if (isDev && enabled) {
    void writeDebugEvent(event)
    yield event as unknown as SSEEvent
  }
}

/**
 * Append a debug event to a sink's accumulator, UNCONDITIONALLY. This is the
 * always-on counterpart to debugYield: debugYield gates the live SSE stream
 * (dev + x-zeno-debug), while recordDebugEvent always captures the event so
 * the full turn can be persisted to the DB regardless of the debug gate.
 */
export function recordDebugEvent(
  sink: { debugEvents: DebugEvent[] },
  event: DebugEvent,
): void {
  sink.debugEvents.push(event)
}

// ==============================================
// MODULE-LEVEL DEV FLAG
// ==============================================

/**
 * True iff the server is running with NODE_ENV === 'development'.
 *
 * Evaluated lazily so vi.stubEnv() works after this module has been
 * imported — otherwise tests that flip NODE_ENV at runtime would be
 * silently ignored.
 */
export function isDev(): boolean {
  return process.env.NODE_ENV === 'development'
}

// ==============================================
// IDENTITY PAYLOAD BUILDER
// ==============================================

export interface BuildIdentityPayloadInput {
  traceId: string
  conversationId: string
  messageIndex: number
  customerId: string
  customer: TurnContextCustomer
  conversation: {
    productId: string | null
    product: { code: string; name: unknown } | null
    candidateProductId: string | null
    candidateConfidence: number | null
    candidateSetAt: Date | null
  }
  insights: RawCustomerInsight[]
  now: Date
}

function extractLocalizedName(
  name: unknown,
  language: string,
): string | null {
  if (!name) return null
  if (typeof name === 'string') return name
  if (typeof name === 'object') {
    const map = name as Record<string, unknown>
    const v = map[language] ?? map.ro ?? map.en
    return typeof v === 'string' ? v : null
  }
  return null
}

/**
 * Pure helper: assemble the debug:identity payload from already-loaded
 * customer + insight data. Tested directly; called from the orchestrator
 * only when isDev() && debugEnabled.
 */
export function buildIdentityPayload(
  input: BuildIdentityPayloadInput,
): DebugIdentityPayload {
  return {
    traceId: input.traceId,
    conversationId: input.conversationId,
    messageIndex: input.messageIndex,
    identity: {
      cookieId: input.customerId,
      isAnonymous: input.customer.isAnonymous,
    },
    customer: {
      name: input.customer.name,
      age: calculateAge(input.customer.dateOfBirth, input.now),
      language: input.customer.language,
    },
    consent: {
      gdprConsentAt: input.customer.gdprConsentAt
        ? input.customer.gdprConsentAt.toISOString()
        : null,
      gdprConsentScope: input.customer.gdprConsentScope,
      aiDisclosureAcknowledgedAt: input.customer.aiDisclosureAcknowledgedAt
        ? input.customer.aiDisclosureAcknowledgedAt.toISOString()
        : null,
    },
    conversation: {
      productId: input.conversation.productId,
      productCode: input.conversation.product?.code ?? null,
      productName: extractLocalizedName(input.conversation.product?.name, input.customer.language),
      candidateProductId: input.conversation.candidateProductId,
      candidateConfidence: input.conversation.candidateConfidence,
      candidateSetAt: input.conversation.candidateSetAt
        ? input.conversation.candidateSetAt.toISOString()
        : null,
    },
    memory: input.insights.map((i) => ({
      id: i.id,
      kind: i.category,
      text: `${i.key}: ${i.value}`,
      createdAt: i.createdAt.toISOString(),
    })),
  }
}
