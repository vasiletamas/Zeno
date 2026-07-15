/**
 * Task 5.5 (D12): quality signals for ConversationScore — computed from the
 * SAME recorded evidence the diagnostics read (ConversationExport), so the
 * self-improvement loop stops being blind to re-asks, unexplained errors
 * and rejected insights. Funnel/cost signals stay in the scorer.
 */
import { runDiagnostics } from '@/lib/diagnostics'
import type { ConversationExport } from '@/lib/debug/conversation-export'

export interface QualitySignals {
  /** collect_customer_field idempotent replays — the agent re-asked a known fact. */
  reaskedKnownFactCount: number
  /** tool_call_failed findings at error severity — a failure never followed by success. */
  unexplainedToolErrorCount: number
  /** insight_rejected anomalies — extractor emissions the typed gate refused. */
  insightRejectedCount: number
}

export function computeQualitySignals(e: ConversationExport): QualitySignals {
  const findings = runDiagnostics(e)
  const anomalies = e.turns.flatMap((t) => ((t.totals?.anomalies ?? []) as { message?: string }[]))
  return {
    reaskedKnownFactCount: findings.filter((f) => f.checkId === 'known_field_reasked').length,
    unexplainedToolErrorCount: findings.filter((f) => f.checkId === 'tool_call_failed' && f.severity === 'error').length,
    insightRejectedCount: anomalies.filter((a) => /insight_rejected/.test(String(a.message ?? ''))).length,
  }
}
