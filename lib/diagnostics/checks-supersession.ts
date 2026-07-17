/**
 * Supersession diagnostics (T13 ratchet, 2026-07-17). Origin: conv
 * cmrm3fgku00056g0y4eb2hsme messageIndex 58 — a GUI sign_medical_declarations
 * result said "The quote can be generated now."; the assistant then told the
 * customer "calcularea nu poate fi finalizată în această conversație" with
 * ZERO generate_quote attempts, although the gate was open (the next user
 * turn quoted instantly). The orchestrator fix gives action turns the
 * standard tool loop and the constitution gained the freshest-evidence-wins
 * clause (seed-agents constraints); this check is the offline net for the
 * stale-gate refusal class.
 */
import { stripDiacritics } from '@/lib/products/aliases'
import { ACTION_DOMAINS, IMPOSSIBILITY, impossibilityNearDomain } from '@/lib/chat/impossibility-lexicon'
import type { DiagnosticCheck, Finding } from './types'

/**
 * message→action table: result `data._message` texts that announce an action
 * is NOW possible. Domain keywords come from the SHARED impossibility
 * lexicon (T16) — the online outbound guard imports the same exports, so the
 * offline net and the live self-repair can never drift (the test asserts
 * import equality).
 */
export const ENABLEMENTS: { pattern: RegExp; action: string; domain: RegExp }[] = [
  { pattern: /quote can (now )?be generated/i, action: 'generate_quote', domain: ACTION_DOMAINS.generate_quote },
  { pattern: /Ready for signature \(sign_dnt\)/, action: 'sign_dnt', domain: ACTION_DOMAINS.sign_dnt },
  { pattern: /can now proceed with insurance applications/i, action: 'set_application', domain: ACTION_DOMAINS.set_application },
]

/** A domain keyword NEAR an impossibility phrase (shared proximity window) —
 * "calcularea nu poate fi finalizată" flags; an unrelated "nu pot" elsewhere
 * does not. Offline scans mixed-language transcripts → the union pattern. */
function claimsImpossibility(prose: string, domain: RegExp): boolean {
  return impossibilityNearDomain(prose, domain, IMPOSSIBILITY) !== null
}

export const staleGateClaim: DiagnosticCheck = {
  id: 'stale_gate_claim',
  description: 'A tool result THIS turn said an action is now possible, the turn made zero calls to it, and the assistant claimed that action\'s domain is impossible (T13, conv cmrm3fgku messageIndex 58)',
  run: (e) => {
    const out: Finding[] = []
    // export contract: the assistant message at index i answers the turn at
    // messageIndex i-1 (same join as hallucinated_ui_reference)
    const turnByIndex = new Map(e.turns.map((t) => [t.messageIndex, t]))
    e.messages.forEach((m, i) => {
      if (m.role !== 'assistant') return
      const t = turnByIndex.get(i - 1)
      if (!t) return
      const prose = stripDiacritics(m.content.toLowerCase())
      for (const { pattern, action, domain } of ENABLEMENTS) {
        const enabling = t.toolCalls.find((c) => {
          const msg = (c.result?.data as { _message?: unknown } | undefined)?._message
          return typeof msg === 'string' && pattern.test(msg)
        })
        if (!enabling) continue
        if (t.toolCalls.some((c) => c.name === action)) continue
        if (!claimsImpossibility(prose, domain)) continue
        const resultMessage = String((enabling.result?.data as { _message?: string })?._message ?? '').slice(0, 120)
        out.push({
          checkId: 'stale_gate_claim',
          severity: 'error',
          turn: t.messageIndex,
          evidence: { action, resultMessage, claim: m.content.slice(0, 120) },
        })
      }
    })
    return out
  },
}
