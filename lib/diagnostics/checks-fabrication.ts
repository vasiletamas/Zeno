/**
 * P0-1 diagnostics (ratchet additions, 2026-07-06): fabrications and false
 * state claims can never pass silently. The write-guard
 * (lib/tools/handlers/grounding-guard.ts) blocks agent fabrications at
 * commit time; these checks are the post-hoc net over recorded
 * conversations — same grounding module, so the two surfaces cannot drift.
 */
import { isValueGrounded } from '@/lib/engines/anti-fabrication'
import { stripDiacritics } from '@/lib/products/aliases'
import type { DiagnosticCheck, Finding } from './types'

const VALUE_ARGS: Record<string, string> = {
  write_dnt_answer: 'value',
  write_question_answer: 'answer',
  modify_answer: 'newValue',
  collect_customer_field: 'value',
}

/** Diagnostics scope: value shapes with a RELIABLE direct anchor. Enum
 * tokens and booleans are excluded — their grounding needs the question's
 * options, which exports do not carry; the write-guard owns them live. */
const inScope = (v: string): boolean =>
  /^\d+\+?$/.test(v) || /@/.test(v) || /^\d{4}-\d{2}-\d{2}$/.test(v)

export const questionnaireAnswerFabricated: DiagnosticCheck = {
  id: 'questionnaire_answer_fabricated',
  description: 'A persisted answer/field value (numeric, email, date) has no anchor in the customer\'s recent messages',
  run: (e) => {
    const out: Finding[] = []
    const ordered = [...e.turns].sort((a, b) => a.messageIndex - b.messageIndex)
    // a value successfully written EARLIER is on record — re-collecting it
    // is idempotent, not invention (run cmr9eli9n: email re-collected 15
    // turns after the customer gave it)
    const seen = new Set<string>()
    for (let ti = 0; ti < ordered.length; ti++) {
      const t = ordered[ti]
      for (const c of t.toolCalls) {
        const argKey = VALUE_ARGS[c.name]
        if (!argKey || c.result?.success !== true) continue
        const value = String((c.args as Record<string, unknown>)?.[argKey] ?? '')
        if (!inScope(value)) continue
        const key = value.toLowerCase().trim()
        if (seen.has(key)) continue
        seen.add(key)
        // 2026-07-20 (conv cmrrhruba turn 12): a card-submitted value is
        // grounded by the card itself — the persisted prose only carries a
        // mask (⟦action⟧✓ Telefon: ***607). The gui-actor ledger row in this
        // turn's window, matching this tool (and, for collects, this field's
        // targetRef), is the deterministic card-submission trace.
        //
        // TurnDebug persistence stamps startedAt/endedAt with two Date.now()
        // calls in the same synchronous post-hoc reduction pass, so every
        // recorded turn has startedAt === endedAt (verified across all 33
        // turns of conv cmrrhruba), landing AFTER the turn's own mid-turn
        // ledger writes (turn 12: gui commit at 08:27:51.410Z, recorded
        // startedAt/endedAt 08:27:55.920Z). t.startedAt is therefore not a
        // usable window floor; turns are strictly sequential, so the
        // preceding turn's endedAt is used instead (same fix as
        // stale_card_replayed in checks-ui.ts).
        const tStart = (ordered[ti - 1] as { endedAt?: number } | undefined)?.endedAt ?? 0
        const tEnd = (t as { endedAt?: number }).endedAt ?? Number.MAX_SAFE_INTEGER
        const guiCommitted = (e.ledger ?? []).some((r) => {
          if (r.actor !== 'gui' || r.tool !== c.name || r.outcome !== 'applied') return false
          const at = Date.parse(r.createdAt)
          if (at < tStart || at > tEnd) return false
          if (c.name === 'collect_customer_field') {
            return r.targetRef === `field:${String((c.args as Record<string, unknown>)?.field ?? '')}`
          }
          return true
        })
        if (guiCommitted) continue
        const userMessages = e.messages
          .map((m, i) => ({ ...m, i }))
          .filter((m) => m.role === 'user' && m.i <= t.messageIndex)
          .slice(-6).map((m) => m.content)
        const assistantMessages = e.messages
          .map((m, i) => ({ ...m, i }))
          .filter((m) => m.role === 'assistant' && m.i < t.messageIndex)
          .slice(-4).map((m) => m.content)
        const r = isValueGrounded({ value, userMessages, assistantMessages })
        if (!r.grounded) {
          out.push({ checkId: 'questionnaire_answer_fabricated', severity: 'warn', turn: t.messageIndex, evidence: { tool: c.name, value } })
        }
      }
    }
    return out
  },
}

// action-claim verbs only — state ASSERTIONS ("oferta rămâne valabilă") and
// acknowledgments ("am notat") are excluded to keep the warn signal clean
const CLAIM = /\bam (corectat|salvat|actualizat|inregistrat|schimbat|modificat|sters)\b/

export const stateClaimWithoutCommit: DiagnosticCheck = {
  id: 'state_claim_without_commit',
  description: 'The assistant claimed a state change ("am corectat/salvat...") in a turn that committed nothing',
  run: (e) => {
    const out: Finding[] = []
    const turnByIndex = new Map(e.turns.map((t) => [t.messageIndex, t]))
    e.messages.forEach((m, i) => {
      if (m.role !== 'assistant') return
      const prose = stripDiacritics(m.content.toLowerCase())
      if (!CLAIM.test(prose)) return
      const t = turnByIndex.get(i - 1)
      if (!t) return
      const committed = (t.legality ?? []).some((l) => l.point === 'post_commit')
        || t.toolCalls.some((c) => c.partition === 'writing' && c.result?.success === true)
      if (!committed) {
        out.push({ checkId: 'state_claim_without_commit', severity: 'warn', turn: t.messageIndex, evidence: { claim: m.content.slice(0, 120) } })
      }
    })
    return out
  },
}
