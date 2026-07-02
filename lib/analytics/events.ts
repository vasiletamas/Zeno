/**
 * Funnel Event Tracking
 *
 * Pre-defined functions for the 7-step sales funnel.
 * All functions are fire-and-forget: they never throw and never block the caller.
 * If PostHog is not configured, every call is a no-op.
 */

import { getPostHog } from './posthog'
import { getTurnCost } from '@/lib/events/cost-subscriber'

// ─── Generic capture helper ───────────────────────────────────

function trackEvent(
  event: string,
  distinctId: string | undefined,
  properties?: Record<string, unknown>,
): void {
  try {
    const posthog = getPostHog()
    if (!posthog || !distinctId) return
    posthog.capture({ distinctId, event, properties })
  } catch {
    // Never throw from analytics
  }
}

// ==============================================
// OBSERVABILITY ENRICHMENT
// ==============================================

export function enrichEventProps(
  traceId: string | null,
  base: Record<string, unknown>,
): Record<string, unknown> {
  if (!traceId) return base
  const turnCost = getTurnCost(traceId)
  return {
    ...base,
    ...(turnCost !== null ? { turnCost } : {}),
  }
}

// ─── Funnel events ────────────────────────────────────────────

export function trackChatStarted(
  customerId: string,
  enrichment?: { conversationMode?: string; traceId?: string },
): void {
  trackEvent('chat_started', customerId, enrichEventProps(
    enrichment?.traceId ?? null,
    {
      ...(enrichment?.conversationMode ? { conversationMode: enrichment.conversationMode } : {}),
    },
  ))
}

export function trackProductSelected(
  customerId: string,
  tierCode: string,
  levelCode: string,
): void {
  trackEvent('product_selected', customerId, { tierCode, levelCode })
}

export function trackDntCompleted(customerId: string): void {
  trackEvent('dnt_completed', customerId)
}

export function trackQuoteGenerated(
  customerId: string,
  premiumAnnual: number,
): void {
  trackEvent('quote_generated', customerId, { premiumAnnual })
}

export function trackQuoteAccepted(
  customerId: string,
  premiumAnnual: number,
): void {
  trackEvent('quote_accepted', customerId, { premiumAnnual })
}

export function trackPaymentCompleted(
  customerId: string,
  amount: number,
): void {
  trackEvent('payment_completed', customerId, { amount })
}

export function trackPolicyIssued(
  customerId: string,
  policyId: string,
): void {
  trackEvent('policy_issued', customerId, { policyId })
}
