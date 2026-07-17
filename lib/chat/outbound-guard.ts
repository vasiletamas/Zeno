/**
 * Outbound contradiction guard (T16, P3.2) — the ONLINE half of the T13
 * stale_gate_claim family. A false impossibility claim about an AVAILABLE
 * funnel action is lost revenue (conv cmrm3fgku00056g0y4eb2hsme
 * messageIndex 58: "calcularea nu poate fi finalizată" with generate_quote
 * open); this pure detector reads the model's DRAFT against the freshest
 * exposure set BEFORE the customer sees it, so the orchestrator can hold the
 * text and run one corrective retry. Patterns live in the shared
 * impossibility-lexicon module — the offline diagnostics check imports the
 * same exports, so the two surfaces cannot drift.
 */
import { stripDiacritics } from '@/lib/products/aliases'
import {
  ACTION_DOMAINS,
  IMPOSSIBILITY_EN,
  IMPOSSIBILITY_RO,
  impossibilityNearDomain,
} from './impossibility-lexicon'

export interface FalseUnavailabilityClaim {
  /** The AVAILABLE funnel action the draft claims is impossible. */
  action: string
  /** Normalized (diacritic-stripped, lowercased) evidence window. */
  claim: string
}

/**
 * Returns a hit ONLY when an impossibility phrase sits near the domain
 * keywords of an action that IS in `available` — a truthful "can't" about a
 * blocked action must pass untouched.
 */
export function detectFalseUnavailabilityClaim(
  text: string,
  available: string[],
  lang: 'en' | 'ro',
): FalseUnavailabilityClaim | null {
  if (!text || available.length === 0) return null
  const prose = stripDiacritics(text.toLowerCase())
  const impossibility = lang === 'en' ? IMPOSSIBILITY_EN : IMPOSSIBILITY_RO
  for (const [action, domain] of Object.entries(ACTION_DOMAINS)) {
    if (!available.includes(action)) continue
    const claim = impossibilityNearDomain(prose, domain, impossibility)
    if (claim) return { action, claim }
  }
  return null
}
