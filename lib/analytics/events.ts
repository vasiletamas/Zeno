/**
 * Funnel Event Tracking
 *
 * Pre-defined functions for the 7-step sales funnel.
 * All functions are fire-and-forget: they never throw and never block the caller.
 * If PostHog is not configured, every call is a no-op.
 */

import { getPostHog } from './posthog'

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

// ─── Funnel events ────────────────────────────────────────────

export function trackChatStarted(customerId: string): void {
  trackEvent('chat_started', customerId)
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
