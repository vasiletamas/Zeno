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
