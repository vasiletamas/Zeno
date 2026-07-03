/**
 * Machine-checkable assertions over a ConversationExport v2 bundle (F2.5).
 *
 * Created F1-forward: the plan has F1's spec sims own this module, but F1 is
 * blocked on the unvendorable spec files (handoff ruling 3), so F2.5 creates
 * it fresh. The ledger↔turn join follows erratum 2: post_commit legality
 * entries carry the applied ledger row's id (commitLedgerId); tool-name-
 * within-conversation is the fallback ONLY for turns recorded before F2
 * (no legality entries) or for ledgered-but-not-applied outcomes
 * (requires_confirmation / rejected never emit post_commit entries).
 */

import type { ConversationExport } from '@/lib/debug/conversation-export'
import type { DebugTurn } from '@/lib/debug/reducer'
import type { DerivedStateV3 } from '@/lib/engines/domain-types'

/**
 * The state the turn's briefing was built from. Prefers the F2 legality
 * snapshot (exact deriveAndExpose output at turn start) over the legacy
 * gate field; null for turns that recorded neither.
 */
export function turnState(t: DebugTurn): DerivedStateV3 | null {
  return (
    t.legality?.find((l) => l.point === 'turn_start')?.state ??
    t.gate?.derivedState ??
    null
  )
}

/**
 * Every applied commit must be traceable to a CommitLedger row, and every
 * successful writing tool call must have SOME ledger row backing it.
 */
export function assertEveryCommitHasLedgerRow(e: ConversationExport): void {
  const rowsById = new Map(e.ledger.map((r) => [r.id, r]))
  const toolsInLedger = new Set(e.ledger.map((r) => r.tool))

  for (const t of e.turns) {
    const postCommits = (t.legality ?? []).filter((l) => l.point === 'post_commit')
    for (const l of postCommits) {
      if (!l.commitLedgerId || !rowsById.has(l.commitLedgerId)) {
        throw new Error(
          `turn ${t.messageIndex}: post_commit legality entry does not resolve to a ledger row (commitLedgerId=${l.commitLedgerId ?? 'missing'})`,
        )
      }
    }
    const successfulWrites = t.toolCalls.filter(
      (c) => c.partition === 'writing' && c.result?.success,
    )
    for (const c of successfulWrites) {
      const joinedById = postCommits.some(
        (l) => l.commitLedgerId && rowsById.get(l.commitLedgerId)?.tool === c.name,
      )
      if (!joinedById && !toolsInLedger.has(c.name)) {
        throw new Error(`turn ${t.messageIndex}: commit without ledger row: ${c.name}`)
      }
    }
  }
}

// ==============================================
// AGENT-BEHAVIORAL ASSERTS (F1.8) — trace/transcript facts over the export
// ==============================================

const PHASE_ORDER = ['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const

export function toolCallsByTurn(e: ConversationExport): string[][] {
  return e.turns.map((t) => t.toolCalls.map((c) => c.name))
}
export function assertToolCalled(e: ConversationExport, tool: string): void {
  if (!toolCallsByTurn(e).flat().includes(tool)) throw new Error(`expected tool ${tool} to be called`)
}
export function assertToolNeverCalled(e: ConversationExport, tool: string): void {
  if (toolCallsByTurn(e).flat().includes(tool)) throw new Error(`tool ${tool} must never be called`)
}
export function assertToolOrder(e: ConversationExport, sequence: string[]): void {
  const flat = toolCallsByTurn(e).flat()
  let i = 0
  for (const name of flat) if (name === sequence[i]) i++
  if (i < sequence.length) throw new Error(`tool order violated: missing ${sequence[i]} (subsequence ${sequence.join(' -> ')})`)
}
export function phaseTimeline(e: ConversationExport): string[] {
  return e.turns.map((t) => turnState(t)?.phase as string | undefined).filter((p): p is string => !!p)
}
export function assertNoPhaseRegression(e: ConversationExport, allow: string[] = []): void {
  const tl = phaseTimeline(e)
  for (let i = 1; i < tl.length; i++) {
    if (PHASE_ORDER.indexOf(tl[i] as never) < PHASE_ORDER.indexOf(tl[i - 1] as never) && !allow.includes(tl[i])) {
      throw new Error(`phase regression ${tl[i - 1]} -> ${tl[i]} at turn ${i}`)
    }
  }
}
export function assertNoNarrationViolations(e: ConversationExport): void {
  for (const t of e.turns) {
    const v = (t.toolNarration as { violations?: unknown[] } | undefined)?.violations ?? []
    if (v.length > 0) throw new Error(`narration violations at messageIndex ${t.messageIndex}: ${JSON.stringify(v)}`)
  }
}
const PREMIUM_RE = /\b(prim[aă]|premium|rat[aă] lunar[aă])\b[^.]{0,40}?\d/i
export function assertNoPremiumBeforeQuote(e: ConversationExport): void {
  const turnByIndex = new Map(e.turns.map((t) => [t.messageIndex, t]))
  let quoteSeen = false
  let turnIdx = -1
  for (const m of e.messages) {
    if (m.role === 'user') turnIdx++
    const st = turnByIndex.get(turnIdx) ? turnState(turnByIndex.get(turnIdx)!) : null
    if (st && (st as { quote?: unknown }).quote) quoteSeen = true
    if (m.role === 'assistant' && !quoteSeen && PREMIUM_RE.test(m.content)) {
      throw new Error(`premium claim before quote: "${m.content.slice(0, 80)}"`)
    }
  }
}

/**
 * No ledger row with outcome 'applied' may name a tool that was in that
 * turn's turn_start blocked list — the executor wall and the gateway must
 * never disagree with the briefing's exposure.
 */
export function assertNoBlockedActionExecuted(e: ConversationExport): void {
  const applied = e.ledger.filter((r) => r.outcome === 'applied')
  for (const t of e.turns) {
    const turnStart = t.legality?.find((l) => l.point === 'turn_start')
    if (!turnStart) continue
    const blocked = new Set(turnStart.actions.blocked.map((b) => b.action))
    // Join applied rows to this turn via its post_commit entries (erratum 2);
    // fall back to any applied row for single-turn/pre-F2 exports.
    const turnLedgerIds = new Set(
      (t.legality ?? [])
        .filter((l) => l.point === 'post_commit' && l.commitLedgerId)
        .map((l) => l.commitLedgerId as string),
    )
    const rowsForTurn = turnLedgerIds.size > 0
      ? applied.filter((r) => turnLedgerIds.has(r.id))
      : applied
    for (const r of rowsForTurn) {
      if (blocked.has(r.tool)) {
        throw new Error(
          `turn ${t.messageIndex}: blocked action executed: ${r.tool} was blocked at turn start yet ledger row ${r.id} applied it`,
        )
      }
    }
  }
}
