/**
 * Consent reducer — PURE, no prisma.
 *
 * Consent truth is the append-only ConsentEvent ledger; the current state is
 * derived here: latest event per kind wins, absent means never granted.
 * gdprWithdrawn is tracked EXPLICITLY (B1 erratum 1): the halt rule fires
 * only on an actual withdrawal, never on the fresh-customer absence state —
 * talk is free, consent is captured at signing.
 */

export interface ConsentEventLike {
  kind: 'gdpr_processing' | 'ai_disclosure' | 'marketing'
  action: 'granted' | 'withdrawn'
  createdAt: Date
}

export interface DerivedConsents {
  gdprProcessing: boolean
  aiDisclosure: boolean
  marketing: boolean
  /** true only when the LATEST gdpr_processing event is an explicit withdrawal */
  gdprWithdrawn: boolean
  /** any ledger history at all — gates withdraw_consent exposure (B1.4) */
  hasAnyEvents: boolean
}

export function deriveConsents(events: ConsentEventLike[]): DerivedConsents {
  const latest = new Map<string, ConsentEventLike>()
  for (const e of [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) latest.set(e.kind, e)
  const on = (k: string) => latest.get(k)?.action === 'granted'
  return {
    gdprProcessing: on('gdpr_processing'),
    aiDisclosure: on('ai_disclosure'),
    marketing: on('marketing'),
    gdprWithdrawn: latest.get('gdpr_processing')?.action === 'withdrawn',
    hasAnyEvents: events.length > 0,
  }
}
