/**
 * Re-engagement candidate selection (E4.4, M2) — PURE decision core
 * (T12.D3). Hard rules, in order: verified channel only, marketing consent
 * present in the B1 ledger, gdpr_processing not withdrawn, frequency cap
 * from the last outbound ledger event; then at most ONE trigger per
 * customer per run (abandoned payment outranks quote expiry).
 */
import type { IdentityTier } from '@/lib/engines/domain-types'
import type { ReEngagementConfig } from '@/lib/engagement/config'

export type ReEngagementTrigger = 'abandoned_payment' | 'quote_expiring'
export interface ReEngagementCandidateInput {
  customerId: string
  conversationId: string | null
  identityTier: IdentityTier
  marketingConsent: boolean        // derived from the B1 ConsentEvent ledger by the caller
  gdprProcessingActive: boolean    // false when gdpr_processing withdrawn (M3)
  lastOutboundAt: Date | null      // latest re_engagement_outbound ledger event
  abandonedPaymentSince: Date | null
  quoteExpiresAt: Date | null
}
export interface ReEngagementCandidate { customerId: string; conversationId: string | null; trigger: ReEngagementTrigger }

const DAY = 24 * 60 * 60 * 1000

export function selectReEngagementCandidates(
  rows: ReEngagementCandidateInput[], config: ReEngagementConfig, now: Date,
): ReEngagementCandidate[] {
  const out: ReEngagementCandidate[] = []
  for (const row of rows) {
    if (row.identityTier !== 'verified_channel') continue
    if (!row.marketingConsent) continue
    if (!row.gdprProcessingActive) continue
    if (row.lastOutboundAt && now.getTime() - row.lastOutboundAt.getTime() < config.frequencyCapDays * DAY) continue
    if (row.abandonedPaymentSince && now.getTime() - row.abandonedPaymentSince.getTime() >= config.abandonedPaymentDays * DAY) {
      out.push({ customerId: row.customerId, conversationId: row.conversationId, trigger: 'abandoned_payment' })
      continue // one outbound per customer per run
    }
    if (row.quoteExpiresAt && row.quoteExpiresAt > now && row.quoteExpiresAt.getTime() - now.getTime() <= config.quoteExpiryWindowDays * DAY) {
      out.push({ customerId: row.customerId, conversationId: row.conversationId, trigger: 'quote_expiring' })
    }
  }
  return out
}
