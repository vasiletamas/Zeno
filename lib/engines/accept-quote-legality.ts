/**
 * accept_quote legality (D2.5, T7.D6) — pure, no DB.
 *
 * Registered as an exposure-predicate input consumed by deriveAndExpose /
 * the gateway legality step (D2 erratum 1) — a decision-core helper, never
 * called ad-hoc from handlers (contradiction #6: deriveAndExpose is the
 * ONLY legality computation). Order: expiry (the shared isExpired
 * predicate) → transition table → identity (T4-R6: verified_channel is the
 * accept-time hard gate) → disclosures (T7.D2: every current document
 * acked at its exact version+language).
 */
import { isExpired } from '@/lib/engines/quote-lifecycle'

export type AcceptQuoteLegalityResult =
  | { ok: true }
  | { ok: false; outcome: 'rejected'; reason: 'quote_expired' | 'illegal_status_transition' }
  | { ok: false; outcome: 'requires_identity'; needs: string[] }
  | { ok: false; outcome: 'requires_disclosures'; needs: string[] }

export function acceptQuoteLegality(
  s: {
    quote: { status: string; validUntil: Date; disclosuresRequired: { kind: string }[] }
    /** missingFields/hasVerifiedChannel (optional): the decomposition facts —
     * without them an unmet tier reports the bare 'verified_channel' label
     * (run cmr9dw3s5 2026-07-06: that label was already satisfied channel-wise
     * and the agent had nothing actionable; callers should thread them). */
    identity: { tier: string; missingFields?: string[]; hasVerifiedChannel?: boolean }
  },
  now: Date,
): AcceptQuoteLegalityResult {
  if (s.quote.status === 'ISSUED' && isExpired({ status: 'ISSUED', validUntil: s.quote.validUntil }, now)) {
    return { ok: false, outcome: 'rejected', reason: 'quote_expired' }
  }
  if (s.quote.status !== 'ISSUED') return { ok: false, outcome: 'rejected', reason: 'illegal_status_transition' }
  if (s.identity.tier !== 'verified_channel') {
    const needs: string[] = []
    for (const f of s.identity.missingFields ?? []) needs.push(`declared:${f}`)
    if (s.identity.hasVerifiedChannel === false) needs.push('verified_channel')
    // decomposition threaded but nothing visible → the one remaining reason
    // is an invalid CNP; without the decomposition keep the coarse label.
    if (needs.length === 0) needs.push(s.identity.missingFields !== undefined && s.identity.hasVerifiedChannel === true ? 'valid:cnp' : 'verified_channel')
    return { ok: false, outcome: 'requires_identity', needs }
  }
  if (s.quote.disclosuresRequired.length > 0) return { ok: false, outcome: 'requires_disclosures', needs: s.quote.disclosuresRequired.map((d) => d.kind) }
  return { ok: true }
}
