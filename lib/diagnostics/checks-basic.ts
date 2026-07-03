/**
 * Basic diagnostic checks (F4.1): structural facts of the recorded turn —
 * failed/orphaned tool calls, dead turns, phase regressions, duplicate
 * debug rows, and relayed runtime anomalies.
 */
import type { DiagnosticCheck, Finding } from './types'
import { PHASE_ORDER, turnPhase } from './types'

export const toolCallFailed: DiagnosticCheck = {
  id: 'tool_call_failed', description: 'A tool call returned success=false',
  run: (e) => e.turns.flatMap((t) => t.toolCalls
    .filter((c) => c.result && c.result.success === false)
    .map((c): Finding => ({ checkId: 'tool_call_failed', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name, error: c.result?.error ?? null } }))),
}

export const toolCallWithoutResult: DiagnosticCheck = {
  id: 'tool_call_without_result', description: 'A tool call has no recorded result',
  run: (e) => e.turns.flatMap((t) => t.toolCalls.filter((c) => !c.result)
    .map((c): Finding => ({ checkId: 'tool_call_without_result', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name } }))),
}

export const turnNotEnded: DiagnosticCheck = {
  id: 'turn_not_ended', description: 'Turn has no endedAt/totals — stream died mid-turn',
  run: (e) => e.turns.filter((t) => !t.endedAt || !t.totals)
    .map((t): Finding => ({ checkId: 'turn_not_ended', severity: 'error', turn: t.messageIndex, evidence: {} })),
}

export const phaseRegression: DiagnosticCheck = {
  id: 'phase_regression', description: 'Derived phase moved backwards without a cancelling commit',
  run: (e) => {
    const out: Finding[] = []
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    const cancelled = e.ledger.some((l) => ['cancel_application', 'cancel_quote', 'cancel_submission', 'request_cancellation'].includes(l.tool) && l.outcome === 'applied')
    for (let i = 1; i < ordered.length; i++) {
      const prev = turnPhase(ordered[i - 1] as never); const cur = turnPhase(ordered[i] as never)
      if (!prev || !cur) continue
      if (PHASE_ORDER.indexOf(cur as never) < PHASE_ORDER.indexOf(prev as never) && !cancelled) {
        out.push({ checkId: 'phase_regression', severity: 'error', turn: ordered[i].messageIndex, evidence: { from: prev, to: cur } })
      }
    }
    return out
  },
}

export const duplicateTurnDebug: DiagnosticCheck = {
  id: 'duplicate_turn_debug', description: 'Two TurnDebug rows share a messageIndex',
  run: (e) => {
    const seen = new Map<number, number>()
    e.turns.forEach((t) => seen.set(t.messageIndex, (seen.get(t.messageIndex) ?? 0) + 1))
    return [...seen].filter(([, n]) => n > 1).map(([idx]): Finding => ({ checkId: 'duplicate_turn_debug', severity: 'warn', turn: idx, evidence: {} }))
  },
}

export const anomaliesReported: DiagnosticCheck = {
  id: 'anomalies_reported', description: 'Runtime invariant monitors fired during the turn',
  run: (e) => e.turns.flatMap((t) => ((t.totals?.anomalies ?? []) as { severity: string; message: string }[])
    .map((a): Finding => ({ checkId: 'anomalies_reported', severity: a.severity === 'critical' ? 'error' : 'warn', turn: t.messageIndex, evidence: { anomaly: a.message } }))),
}
