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
  s: { quote: { status: string; validUntil: Date; disclosuresRequired: { kind: string }[] }; identity: { tier: string } },
  now: Date,
): AcceptQuoteLegalityResult {
  if (s.quote.status === 'ISSUED' && isExpired({ status: 'ISSUED', validUntil: s.quote.validUntil }, now)) {
    return { ok: false, outcome: 'rejected', reason: 'quote_expired' }
  }
  if (s.quote.status !== 'ISSUED') return { ok: false, outcome: 'rejected', reason: 'illegal_status_transition' }
  if (s.identity.tier !== 'verified_channel') return { ok: false, outcome: 'requires_identity', needs: ['verified_channel'] }
  if (s.quote.disclosuresRequired.length > 0) return { ok: false, outcome: 'requires_disclosures', needs: s.quote.disclosuresRequired.map((d) => d.kind) }
  return { ok: true }
}
