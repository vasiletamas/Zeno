/**
 * Card-reference diagnostics (T11 ratchet, 2026-07-15). Origin: conv
 * cmrm3fgku00056g0y4eb2hsme msgs 54-56 — the completion result said a sign
 * card "must confirm" the medical declarations while emitting nothing; the
 * model wrote "…confirmi declarațiile medicale pe cardul afișat", the card
 * never existed, and the customer was stranded until typing the
 * confirmation. The constitution now forbids referencing cards no tool
 * emitted this turn (seed-agents constraints); this check is the offline net.
 */
import { stripDiacritics } from '@/lib/products/aliases'
import type { DiagnosticCheck, Finding } from './types'

/** Diacritic-stripped, lowercased card references ("cardul afișat", "pe card",
 * "de pe card"). "pe card" deliberately excludes "pe cardul…" (\b) — the bare
 * "cardul" alternative owns that form. */
const CARD_REFERENCE = /\b(cardul|pe card|card afisat|de pe card)\b/

/**
 * A turn's PERSISTED card trace. Emitted cards ride tool results
 * (`result.uiAction`, offline-visible). Orchestrator-synthesized confirm
 * cards are NOT persisted as uiActions — their offline proxy is the
 * requires_confirmation envelope the gateway returns with the result:
 * `data._instruction` naming the confirmation card, or a `data.preview` on a
 * non-success result (gateway.ts static + handler-conditional confirm paths).
 *
 * 2026-07-20 amendment (spec §5): a card the ON-SCREEN CARDS briefing listed
 * at turn start is on screen whether or not THIS turn emitted it — the
 * constitution now licenses referencing it (and REQUIRES addressing an
 * expired/deferred one), so `briefedCards` is a trace in its own right.
 */
const hasCardTrace = (t: { toolCalls: { result?: { success?: boolean; uiAction?: unknown; data?: unknown } }[]; briefedCards?: { key: string }[] }): boolean =>
  (t.briefedCards?.length ?? 0) > 0 ||
  t.toolCalls.some((c) => {
    if (c.result?.uiAction) return true
    const d = c.result?.data as { _instruction?: unknown; preview?: unknown } | undefined
    if (typeof d?._instruction === 'string' && d._instruction.toLowerCase().includes('confirmation card')) return true
    return c.result?.success === false && d?.preview !== undefined
  })

export const hallucinatedUiReference: DiagnosticCheck = {
  id: 'hallucinated_ui_reference',
  description: 'The assistant referenced a card ("cardul afișat", "pe card") in a turn whose tool results emitted none (T11, conv cmrm3fgku msgs 54-56)',
  run: (e) => {
    const out: Finding[] = []
    // export contract: the assistant message at index i answers the turn at
    // messageIndex i-1 (same join as state_claim_without_commit)
    const turnByIndex = new Map(e.turns.map((t) => [t.messageIndex, t]))
    e.messages.forEach((m, i) => {
      if (m.role !== 'assistant') return
      const prose = stripDiacritics(m.content.toLowerCase())
      if (!CARD_REFERENCE.test(prose)) return
      const t = turnByIndex.get(i - 1)
      if (!t || hasCardTrace(t)) return
      out.push({ checkId: 'hallucinated_ui_reference', severity: 'error', turn: t.messageIndex, evidence: { claim: m.content.slice(0, 120) } })
    })
    return out
  },
}
