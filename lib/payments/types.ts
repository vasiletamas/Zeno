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
    referenceId: string // D3.3: the schedule id (was policyId — no policy exists pre-capture)
    description: string
  }): Promise<PaymentIntent>

  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>

  /** D3.3 (T8.D4): cancel an open intent so superseding never stacks
   *  capturable sessions — the single-open-attempt invariant. */
  cancelPaymentIntent(providerPaymentId: string): Promise<void>

  /** D4.5: refund a captured payment — the payment-module system effect
   *  behind free-look cancellation and pre-activation rejection (#5). */
  refundPayment(providerPaymentId: string, amountMinor: number): Promise<{ providerRefundId: string }>

  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>
}
