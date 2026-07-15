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
    for (const t of ordered) {
      for (const c of t.toolCalls) {
        const argKey = VALUE_ARGS[c.name]
        if (!argKey || c.result?.success !== true) continue
        const value = String((c.args as Record<string, unknown>)?.[argKey] ?? '')
        if (!inScope(value)) continue
        const key = value.toLowerCase().trim()
        if (seen.has(key)) continue
        seen.add(key)
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
