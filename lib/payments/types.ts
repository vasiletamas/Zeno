/**
 * Payment Provider Abstraction — Types
 *
 * Defines the interfaces for the payment provider abstraction layer.
 * All providers (Stripe, PayU, mock) implement the PaymentProvider interface.
 */

export interface PaymentIntent {
  clientSecret: string // for client-side confirmation (Stripe)
  providerPaymentId: string // provider's payment/order ID
  providerName: string // 'stripe' | 'payu' | 'mock'
  redirectUrl?: string // for redirect-based providers (PayU)
}

export interface PaymentStatus {
  status: 'pending' | 'completed' | 'failed'
  paidAt?: Date
  failureReason?: string
}

export interface WebhookEvent {
  // D2.7: 'ignored' is EXPLICIT — verified-but-irrelevant events never
  // masquerade as payment outcomes; eventId is the provider's event identity
  // feeding the settlement inbox's exactly-once key (T8.D3).
  event: 'payment_succeeded' | 'payment_failed' | 'ignored'
  eventId: string
  providerPaymentId: string
  metadata?: Record<string, unknown>
}

export interface PaymentProvider {
  name: string

  createPaymentIntent(input: {
    amount: number // in smallest currency unit (RON bani = amount * 100)
    currency: string // 'RON'
    customerId: string
    policyId: string
    description: string
  }): Promise<PaymentIntent>

  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>

  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>
}
