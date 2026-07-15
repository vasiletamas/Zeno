/**
 * Re-engagement thresholds (E4, M2) — CONFIG, not DB. v1 triggers only:
 * abandoned payment and quote-nearing-expiry; dunning for later
 * installments is explicitly NOT here (M16).
 */
export interface ReEngagementConfig {
  abandonedPaymentDays: number
  quoteExpiryWindowDays: number
  frequencyCapDays: number
}
export const RE_ENGAGEMENT_CONFIG: ReEngagementConfig = {
  abandonedPaymentDays: 3,
  quoteExpiryWindowDays: 5,
  frequencyCapDays: 7,
}

/**
 * Shared with the engine's dnt_expiring flag window (deriveAndExpose flags
 * a DNT expiring within 30 days) — one constant, two consumers.
 */
export const DNT_EXPIRY_WINDOW_DAYS = 30
