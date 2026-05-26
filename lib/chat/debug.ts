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
import type { TurnContextCustomer } from './turn-context'
import type { RawCustomerInsight } from './context-loaders'
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
    extractedProfile: Record<string, unknown>
  }
  consent: {
    gdprConsentAt: string | null
    gdprConsentScope: string | null
    aiDisclosureAcknowledgedAt: string | null
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

function computeAge(dateOfBirth: Date | null, now: Date): number | null {
  if (!dateOfBirth) return null
  let age = now.getFullYear() - dateOfBirth.getFullYear()
  const monthDiff = now.getMonth() - dateOfBirth.getMonth()
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getDate() < dateOfBirth.getDate())
  ) {
    age--
  }
  return age
}

export interface BuildIdentityPayloadInput {
  traceId: string
  conversationId: string
  messageIndex: number
  customerId: string
  customer: TurnContextCustomer
  insights: RawCustomerInsight[]
}

/**
 * Pure helper: assemble the debug:identity payload from already-loaded
 * customer + insight data. Tested directly; called from the orchestrator
 * only when isDev() && debugEnabled.
 */
export function buildIdentityPayload(
  input: BuildIdentityPayloadInput,
): DebugIdentityPayload {
  const now = new Date()
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
      age: computeAge(input.customer.dateOfBirth, now),
      language: input.customer.language,
      extractedProfile: input.customer.extractedProfile,
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
    memory: input.insights.map((i) => ({
      id: i.id,
      kind: i.category,
      text: `${i.key}: ${i.value}`,
      createdAt: i.createdAt.toISOString(),
    })),
  }
}
