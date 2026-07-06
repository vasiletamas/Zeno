/**
 * v2 envelope/legality checks (F4.3): the gateway's recorded consequences
 * against the turn's recorded legality. Ledger rows join their turn via the
 * post_commit legality commitLedgerId (erratum 3 — never by tool name when
 * the F2 data exists).
 */
import type { ConversationExport } from '@/lib/debug/conversation-export'
import type { DiagnosticCheck, Finding } from './types'
import { recomputeAndDiff } from '@/lib/debug/recompute-diff'
import type { DebugTurn } from '@/lib/debug/reducer'

export const blockedActionAttempted: DiagnosticCheck = {
  id: 'blocked_action_attempted', description: "An applied ledger commit's tool was blocked as of the commit BEFORE it (turn_start for the first; each post_commit snapshot re-baselines its successors)",
  run: (e) => {
    const rowsById = new Map(e.ledger.map((r) => [r.id, r]))
    const out: Finding[] = []
    for (const t of e.turns) {
      const turnStart = (t.legality ?? []).find((l) => l.point === 'turn_start')
      if (!turnStart) continue
      // Rolling baseline: a mid-turn commit legally unblocks its successors
      // (run cmr99s5cb turn 52: write_question_answer completed the
      // questionnaire, making the same-turn generate_quote legal) — judging
      // every commit against turn_start reports legal commits as violations.
      let blocked = new Map(turnStart.actions.blocked.map((b) => [b.action, b.reason]))
      for (const l of (t.legality ?? []).filter((x) => x.point === 'post_commit')) {
        const row = l.commitLedgerId ? rowsById.get(l.commitLedgerId) : undefined
        if (row && row.outcome === 'applied' && blocked.has(row.tool)
          // Task 1.1 (D5): an explicit resend:true or a NEW target legally
          // applies while legality lists the tool blocked — the gateway's
          // verificationResendEscape is a deliberate arg-level hatch the
          // action-level snapshot cannot see.
          && blocked.get(row.tool) !== 'verification_already_pending') {
          out.push({ checkId: 'blocked_action_attempted', severity: 'error', turn: t.messageIndex, evidence: { tool: row.tool, reason: blocked.get(row.tool) } })
        }
        if (l.actions) blocked = new Map(l.actions.blocked.map((b) => [b.action, b.reason]))
      }
    }
    return out
  },
}

export const missingConsequences: DiagnosticCheck = {
  id: 'missing_consequences', description: 'A successful writing tool call has no CommitLedger row backing it',
  run: (e) => {
    const rowsById = new Map(e.ledger.map((r) => [r.id, r]))
    const toolsInLedger = new Set(e.ledger.map((r) => r.tool))
    const out: Finding[] = []
    for (const t of e.turns) {
      const postTools = new Set((t.legality ?? [])
        .filter((l) => l.point === 'post_commit' && l.commitLedgerId)
        .map((l) => rowsById.get(l.commitLedgerId as string)?.tool)
        .filter(Boolean))
      for (const c of t.toolCalls.filter((x) => x.partition === 'writing' && x.result?.success)) {
        if (!postTools.has(c.name) && !toolsInLedger.has(c.name)) {
          out.push({ checkId: 'missing_consequences', severity: 'error', turn: t.messageIndex, evidence: { tool: c.name } })
        }
      }
    }
    return out
  },
}

export interface RecomputeOptions {
  derive?: Parameters<typeof recomputeAndDiff>[1]['derive']
  currentEngineVersion?: string
}

/** erratum 2: recompute is OPT-IN — only the CLI (and tests) thread the
 * options; synthetic fixtures never hit the real deriveAndExpose. */
export function recomputeDriftFindings(e: ConversationExport, opts: RecomputeOptions): Finding[] {
  if (!opts.currentEngineVersion) return []
  const diffs = recomputeAndDiff(e.turns as DebugTurn[], {
    currentEngineVersion: opts.currentEngineVersion,
    derive: opts.derive,
  })
  return diffs.map((d): Finding => ({
    checkId: 'recompute_drift',
    severity: d.kind === 'same_version_drift' ? 'error' : 'info',
    turn: d.messageIndex,
    evidence: { kind: d.kind, point: d.point, storedEngineVersion: d.storedEngineVersion, stateDiff: d.stateDiff, actionsDiff: d.actionsDiff },
  }))
}
