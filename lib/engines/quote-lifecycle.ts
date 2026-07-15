/**
 * Pure quote-lifecycle engine (D1.2, T7.D5) — no DB access. ONE isExpired
 * predicate consumed by every read and legality check; opportunistic
 * EXPIRED writes happen at the gateway on commit attempts, never here.
 */
export type QuoteStatusV3 = 'ISSUED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED'
export interface QuoteLifecycleSnapshot { status: QuoteStatusV3; validUntil: Date }

export function isExpired(q: QuoteLifecycleSnapshot, now: Date): boolean {
  return q.status === 'ISSUED' && q.validUntil.getTime() < now.getTime()
}

export function effectiveQuoteStatus(q: QuoteLifecycleSnapshot, now: Date): QuoteStatusV3 {
  return isExpired(q, now) ? 'EXPIRED' : q.status
}

const TRANSITIONS: Record<QuoteStatusV3, QuoteStatusV3[]> = {
  ISSUED: ['ACCEPTED', 'EXPIRED', 'CANCELLED'],
  ACCEPTED: [],
  EXPIRED: [],
  CANCELLED: [],
}

export function canQuoteTransition(from: QuoteStatusV3, to: QuoteStatusV3): boolean {
  return TRANSITIONS[from].includes(to)
}
