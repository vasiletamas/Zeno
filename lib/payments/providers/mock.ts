/**
 * Mock Payment Provider
 *
 * For development without payment credentials.
 * Always succeeds after simulated processing.
 * No external dependencies required.
 */

import type {
  PaymentProvider,
  PaymentIntent,
  PaymentStatus,
  WebhookEvent,
} from '../types'

export class MockPaymentProvider implements PaymentProvider {
  name = 'mock'

  async createPaymentIntent(input: {
    amount: number
    currency: string
    customerId: string
    referenceId: string
    description: string
  }): Promise<PaymentIntent> {
    // D2.7 (erratum 9): Payment.providerPaymentId is @unique — Date.now()
    // collides for two intents in the same millisecond.
    const providerPaymentId = `mock_pay_${crypto.randomUUID()}`

    return {
      clientSecret: 'mock_secret',
      providerPaymentId,
      providerName: this.name,
    }
  }

  async getPaymentStatus(
    providerPaymentId: string,
  ): Promise<PaymentStatus> {
    // Simulate a 2-second processing delay in real usage
    await new Promise((resolve) => setTimeout(resolve, 2000))

    return {
      status: 'completed',
      paidAt: new Date(),
    }
  }

  async cancelPaymentIntent(_providerPaymentId: string): Promise<void> {
    // mock intents hold no provider state — cancellation is a no-op
  }

  async refundPayment(providerPaymentId: string, _amountMinor: number): Promise<{ providerRefundId: string }> {
    return { providerRefundId: `refund_${providerPaymentId}` }
  }

  async handleWebhook(
    payload: unknown,
    signature: string,
  ): Promise<WebhookEvent> {
    const body = (
      typeof payload === 'string' ? JSON.parse(payload) : payload
    ) as { providerPaymentId?: string }

    const providerPaymentId = body.providerPaymentId ?? `mock_pay_${crypto.randomUUID()}`
    return {
      event: 'payment_succeeded',
      eventId: `mock_${providerPaymentId}`,
      providerPaymentId,
    }
  }
}
