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
    policyId: string
    description: string
  }): Promise<PaymentIntent> {
    const providerPaymentId = `mock_pay_${Date.now()}`

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

  async handleWebhook(
    payload: unknown,
    signature: string,
  ): Promise<WebhookEvent> {
    const body = (
      typeof payload === 'string' ? JSON.parse(payload) : payload
    ) as { providerPaymentId?: string }

    return {
      event: 'payment_succeeded',
      providerPaymentId:
        body.providerPaymentId ?? `mock_pay_${Date.now()}`,
    }
  }
}
