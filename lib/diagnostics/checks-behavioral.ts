/**
 * Behavioral v1 checks (F4.2): conversation-level patterns — the briefing/
 * exposure split (the live 10-tool regression class), funnel stalls,
 * state/phase inconsistencies, latency outliers, deflection loops, and
 * early endings.
 */
import type { DiagnosticCheck, Finding } from './types'
import { turnPhase } from './types'

/** erratum 1: the F2.4 monitor already computed this at turn time and
 * persisted it as an anomaly — relay it with its actions rather than
 * recomputing from a prompt field that is never persisted. */
export const briefingToolNotExposed: DiagnosticCheck = {
  id: 'briefing_tool_not_exposed', description: 'The briefing recommended an action the executor wall would reject',
  run: (e) => e.turns.flatMap((t) => ((t.totals?.anomalies ?? []) as { message?: string; metadata?: { actions?: string[] } }[])
    .filter((a) => a.message === 'briefing_action_not_exposed')
    .map((a): Finding => ({ checkId: 'briefing_tool_not_exposed', severity: 'error', turn: t.messageIndex, evidence: { actions: a.metadata?.actions ?? [] } }))),
}

/** A turn carries a commit iff a post_commit legality entry exists (F2.2 —
 * one per applied envelope) or a writing tool call succeeded. */
function turnHasCommit(t: { legality?: { point: string }[]; toolCalls: { partition: string; result?: { success: boolean } }[] }): boolean {
  if (t.legality?.some((l) => l.point === 'post_commit')) return true
  return t.toolCalls.some((c) => c.partition === 'writing' && c.result?.success)
}

export const funnelStalled: DiagnosticCheck = {
  id: 'funnel_stalled', description: '>=4 consecutive turns in the same phase with zero commits',
  run: (e) => {
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    const out: Finding[] = []
    let start = 0
    for (let i = 0; i <= ordered.length; i++) {
      const samePhase = i < ordered.length && i > start
        && turnPhase(ordered[i] as never) !== null
        && turnPhase(ordered[i] as never) === turnPhase(ordered[start] as never)
      if (i < ordered.length && (i === start || samePhase)) continue
      const window = ordered.slice(start, i)
      if (window.length >= 4 && window.every((t) => t.endedAt && !turnHasCommit(t as never)) && turnPhase(window[0] as never)) {
        out.push({
          checkId: 'funnel_stalled', severity: 'warn', turn: window[window.length - 1].messageIndex,
          evidence: { fromTurn: window[0].messageIndex, toTurn: window[window.length - 1].messageIndex, phase: turnPhase(window[0] as never) },
        })
      }
      start = i
    }
    return out
  },
}

const PHASE_REQUIRES: Record<string, (s: Record<string, unknown>) => boolean> = {
  APPLICATION: (s) => !!s.application,
  QUOTE: (s) => !!s.quote,
  PAYMENT: (s) => !!s.schedule && (s.schedule as { exists?: boolean }).exists !== false,
  POLICY: (s) => !!s.policy,
}

export const stateSnapshotInconsistent: DiagnosticCheck = {
  id: 'state_snapshot_inconsistent', description: 'Derived phase contradicts its own state predicate (#10 table)',
  run: (e) => e.turns.flatMap((t): Finding[] => {
    const entry = (t.legality ?? []).find((l) => l.point === 'turn_start')
    if (!entry) return []
    const state = entry.state as unknown as Record<string, unknown>
    const phase = state.phase as string | undefined
    const requires = phase ? PHASE_REQUIRES[phase] : undefined
    if (requires && !requires(state)) {
      return [{ checkId: 'state_snapshot_inconsistent', severity: 'error', turn: t.messageIndex, evidence: { phase } }]
    }
    return []
  }),
}

export const latencyOutlier: DiagnosticCheck = {
  id: 'latency_outlier', description: 'Turn latency above 30s',
  run: (e) => e.turns.filter((t) => (t.totals?.latencyMs ?? 0) > 30_000)
    .map((t): Finding => ({ checkId: 'latency_outlier', severity: 'warn', turn: t.messageIndex, evidence: { latencyMs: t.totals?.latencyMs } })),
}

/** Trigram-set Jaccard similarity — exported for reuse. */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const t = new Set<string>()
    const n = s.toLowerCase()
    for (let i = 0; i + 3 <= n.length; i++) t.add(n.slice(i, i + 3))
    return t
  }
  const ga = grams(a); const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return a === b ? 1 : 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  return inter / (ga.size + gb.size - inter)
}

export const repeatedAssistantMessage: DiagnosticCheck = {
  id: 'repeated_assistant_message', description: 'Consecutive near-identical assistant messages (deflection loop)',
  run: (e) => {
    const assist = e.messages.filter((m) => m.role === 'assistant')
    const out: Finding[] = []
    for (let i = 1; i < assist.length; i++) {
      const sim = trigramSimilarity(assist[i - 1].content, assist[i].content)
      if (sim > 0.85) out.push({ checkId: 'repeated_assistant_message', severity: 'warn', turn: null, evidence: { similarity: Number(sim.toFixed(3)), message: assist[i].content.slice(0, 80) } })
    }
    return out
  },
}

export const endedPreClosing: DiagnosticCheck = {
  id: 'ended_pre_closing', description: 'Conversation ends while the funnel is pre-PAYMENT (batch mode interprets against the --since window)',
  run: (e) => {
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    const last = ordered[ordered.length - 1]
    const phase = last ? turnPhase(last as never) : null
    if (phase && ['DISCOVERY', 'APPLICATION', 'QUOTE'].includes(phase)) {
      return [{ checkId: 'ended_pre_closing', severity: 'info', turn: last.messageIndex, evidence: { phase } }]
    }
    return []
  },
}
