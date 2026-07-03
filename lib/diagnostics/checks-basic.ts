/**
 * Basic diagnostic checks (F4.1): structural facts of the recorded turn —
 * failed/orphaned tool calls, dead turns, phase regressions, duplicate
 * debug rows, and relayed runtime anomalies.
 */
import type { DiagnosticCheck, Finding } from './types'
import { PHASE_ORDER, turnPhase } from './types'

export const toolCallFailed: DiagnosticCheck = {
  // Verified from source (F4.6 spot-check): domain-legal non-applies
  // (requires_confirmation previews, gateway rejections) come back
  // success=false WITHOUT an error — the wall working, own checks cover
  // them. Error-carrying failures split by recovery: a later successful
  // call to the same tool means the agent bounced off a validation wall
  // and recovered (warn); a failure never followed by success is the
  // stuck/broken class (error).
  id: 'tool_call_failed', description: 'A tool call failed with an error; severity by whether the tool ever succeeded afterwards',
  run: (e) => {
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    const calls = ordered.flatMap((t, i) => t.toolCalls.map((c) => ({ t, seq: i, c })))
    return calls
      .filter(({ c }) => c.result && c.result.success === false && c.result.error != null)
      .map(({ t, seq, c }): Finding => {
        const recovered = calls.some(({ seq: s2, c: c2 }) => s2 >= seq && c2.name === c.name && c2.result?.success === true)
        return { checkId: 'tool_call_failed', severity: recovered ? 'warn' : 'error', turn: t.messageIndex, evidence: { tool: c.name, error: c.result?.error ?? null, recovered } }
      })
  },
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
  // 1:1 severity map (walkthrough finding): info anomalies (e.g. the
  // multi-round "LLM retry detected" heuristic, idempotent_replay) must not
  // inflate into warns — the anomaly's own severity IS the verdict.
  id: 'anomalies_reported', description: 'Runtime invariant monitors fired during the turn',
  run: (e) => e.turns.flatMap((t) => ((t.totals?.anomalies ?? []) as { severity: string; message: string }[])
    .map((a): Finding => ({
      checkId: 'anomalies_reported',
      severity: a.severity === 'critical' ? 'error' : a.severity === 'warning' ? 'warn' : 'info',
      turn: t.messageIndex,
      evidence: { anomaly: a.message },
    }))),
}
