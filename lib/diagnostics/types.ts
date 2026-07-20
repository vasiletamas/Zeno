/**
 * Diagnostics core types (F4.1, T14.D6). Every check is a small PURE
 * function over ConversationExport v2 — the same recorded evidence the
 * drawer, the assertion library and the sim fixtures read. Findings carry
 * machine-usable evidence, never prose interpretations.
 */
import type { ConversationExport } from '@/lib/debug/conversation-export'

export type FindingSeverity = 'error' | 'warn' | 'info'
export interface Finding { checkId: string; severity: FindingSeverity; turn: number | null; evidence: Record<string, unknown> }
export interface DiagnosticCheck { id: string; description: string; run(e: ConversationExport): Finding[] }
export const PHASE_ORDER = ['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'] as const

export function turnPhase(t: { legality?: { point: string; state: { phase?: string } }[] }): string | null {
  return t.legality?.find((l) => l.point === 'turn_start')?.state.phase ?? null
}

/** Structural subset of DebugTurn that turnLedgerWindow needs. */
export interface DebugTurnLike { endedAt?: number }

/**
 * The ledger-window invariant (2026-07-20, conv cmrrhruba0001g40yh3am7peo,
 * all 33 turns verified): TurnDebug persistence
 * (lib/chat/turn-debug-persistence.ts) reduces a turn's whole recorded
 * event list in ONE synchronous pass, so startedAt and endedAt are both
 * Date.now() calls a fraction of a millisecond apart — every persisted turn
 * has startedAt === endedAt (or ~1ms jitter), and that single instant lands
 * AFTER the turn's own mid-turn ledger writes (turn 12: ledger createdAt
 * 08:27:53.738Z, recorded startedAt/endedAt 08:27:55.920Z — 2.18s later). A
 * turn's own startedAt is therefore not a usable lower bound for "which
 * ledger rows did this turn produce."
 *
 * Turns ARE strictly sequential (endedAt strictly increasing turn-to-turn),
 * so the PRECEDING turn's endedAt is used as the floor instead, and this
 * turn's own endedAt as the ceiling. Boundary convention: a ledger row
 * created exactly AT the floor belongs to the PREVIOUS turn, not this one
 * — callers must filter with `at > floor && at <= ceil`.
 */
export function turnLedgerWindow(ordered: DebugTurnLike[], i: number): { floor: number; ceil: number } {
  return {
    floor: ordered[i - 1]?.endedAt ?? 0,
    ceil: ordered[i]?.endedAt ?? Number.MAX_SAFE_INTEGER,
  }
}
