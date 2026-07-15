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

export const confirmationStalled: DiagnosticCheck = {
  // Ratchet addition (2026-07-06 triage): the 52-reissue sign_dnt deadlock
  // produced ZERO warn/error findings — requires_confirmation outcomes carry
  // no error string (tool_call_failed skips them by design) and the
  // confirm_token_reissued anomaly is info-only. A trailing run of
  // requires_confirmation for one tool with no subsequent apply IS the
  // stuck-at-confirmation class: warn at 2, error at >= 3.
  id: 'confirmation_stalled', description: 'Repeated requires_confirmation for the same tool with no subsequent apply — the confirm card is not being completed',
  run: (e) => {
    const trailing = new Map<string, number>()
    for (const l of e.ledger as { tool: string; outcome: string }[]) {
      if (l.outcome === 'requires_confirmation') trailing.set(l.tool, (trailing.get(l.tool) ?? 0) + 1)
      else if (l.outcome === 'applied') trailing.delete(l.tool)
    }
    return [...trailing]
      .filter(([, n]) => n >= 2)
      .map(([tool, n]): Finding => ({ checkId: 'confirmation_stalled', severity: n >= 3 ? 'error' : 'warn', turn: null, evidence: { tool, reissues: n } }))
  },
}

export const dntAnswerFabricated: DiagnosticCheck = {
  // Ratchet addition (2026-07-06 triage): the model persisted DNT answers the
  // customer never gave (family size "2" after five bare "da" replies).
  // Narrow-by-design numeric heuristic: a successful write_dnt_answer whose
  // value is a bare number (e.g. "2", "4+") that appears in none of the last
  // four user messages has no textual anchor in the customer's words.
  // Known limitation: number WORDS ("doi") are not matched — widen only with
  // evidence, never weaken (ratchet rule).
  id: 'dnt_answer_fabricated', description: 'A numeric DNT answer was saved without the number appearing in the customer\'s recent messages',
  run: (e) => {
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    const out: Finding[] = []
    ordered.forEach((t, i) => {
      for (const c of t.toolCalls) {
        if (c.name !== 'write_dnt_answer' || c.result?.success !== true) continue
        const value = String((c.args as { value?: unknown })?.value ?? '')
        if (!/^\d+\+?$/.test(value)) continue
        const digits = value.replace(/\+$/, '')
        const recentUserProse = ordered.slice(Math.max(0, i - 3), i + 1).map((x) => String((x as { userMessage?: unknown }).userMessage ?? '')).join(' ')
        if (!recentUserProse.includes(digits)) {
          out.push({ checkId: 'dnt_answer_fabricated', severity: 'warn', turn: t.messageIndex, evidence: { questionCode: (c.args as { questionCode?: unknown })?.questionCode ?? null, value } })
        }
      }
    })
    return out
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
