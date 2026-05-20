// ==============================================
// ANOMALY
// ==============================================

export interface Anomaly {
  type: 'latency' | 'cost' | 'error_pattern' | 'behavioral'
  severity: 'info' | 'warning' | 'critical'
  message: string
  metadata: Record<string, unknown>
}

// ==============================================
// ZENO EVENTS — 12 typed lifecycle events
// ==============================================

export type ZenoEvent =
  // Core pipeline events (8)
  | { type: 'turn:start'; traceId: string; conversationId: string; messageIndex: number; timestamp: number }
  | { type: 'turn:end'; traceId: string; conversationId: string; cost: number | null; latencyMs: number; anomalies: Anomaly[] }
  | { type: 'phase:start'; traceId: string; phase: string; timestamp: number }
  | { type: 'phase:end'; traceId: string; phase: string; durationMs: number; metadata?: Record<string, unknown> }
  | { type: 'llm:call:start'; traceId: string; provider: string; model: string; agentSlug: string }
  | { type: 'llm:call:end'; traceId: string; provider: string; model: string; inputTokens: number; outputTokens: number; durationMs: number }
  | { type: 'tool:start'; traceId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool:end'; traceId: string; toolName: string; durationMs: number; success: boolean; cached: boolean }
  // Business events (4)
  | { type: 'mode:transition'; traceId: string; from: string; to: string; conversationId: string }
  | { type: 'skillpack:activated'; traceId: string; slugs: string[]; conversationId: string }
  | { type: 'skillpack:deactivated'; traceId: string; slugs: string[]; conversationId: string }
  | { type: 'compliance:result'; traceId: string; passed: boolean; gaps: string[]; conversationId: string }
  | { type: 'side_effect:invalid'; traceId: string; conversationId: string; violations: Array<{ category: string; matchedPhrase: string }> }
  // Infrastructure events
  | { type: 'cache:status'; traceId: string; provider: string; cacheRead: number; cacheWrite: number; cacheHit: boolean }

// ==============================================
// HANDLER TYPE
// ==============================================

export type ZenoEventType = ZenoEvent['type']
export type EventHandler = (event: ZenoEvent) => void | Promise<void>
