/**
 * Stripe Payment Provider
 *
 * Server-side Stripe SDK integration using test mode.
 * Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars.
 */

import Stripe from 'stripe'
import type {
  PaymentProvider,
  PaymentIntent,
  PaymentStatus,
  WebhookEvent,
} from '../types'

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Required for Stripe payment provider.',
    )
  }
  return new Stripe(secretKey)
}

export class StripePaymentProvider implements PaymentProvider {
  name = 'stripe'

  private stripe: Stripe

  constructor() {
    this.stripe = getStripeClient()
  }

  async createPaymentIntent(input: {
    amount: number
    currency: string
    customerId: string
    policyId: string
    description: string
  }): Promise<PaymentIntent> {
    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      description: input.description,
      metadata: {
        customerId: input.customerId,
        policyId: input.policyId,
      },
    })

    return {
      clientSecret: paymentIntent.client_secret ?? '',
      providerPaymentId: paymentIntent.id,
      providerName: this.name,
    }
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const paymentIntent =
      await this.stripe.paymentIntents.retrieve(providerPaymentId)

    switch (paymentIntent.status) {
      case 'succeeded':
        return {
          status: 'completed',
          paidAt: new Date(paymentIntent.created * 1000),
        }
      case 'canceled':
        return {
          status: 'failed',
          failureReason:
            paymentIntent.cancellation_reason ?? 'Payment cancelled',
        }
      case 'requires_payment_method':
        return {
          status: 'failed',
          failureReason: 'Payment method required or failed',
        }
      default:
        // processing, requires_confirmation, requires_action, etc.
        return { status: 'pending' }
    }
  }

  async handleWebhook(
    payload: unknown,
    signature: string,
  ): Promise<WebhookEvent> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is not set. Required for webhook validation.',
      )
    }

    const event = this.stripe.webhooks.constructEvent(
      payload as string | Buffer,
      signature,
      webhookSecret,
    )

    const paymentIntent = event.data.object as Stripe.PaymentIntent

    switch (event.type) {
      case 'payment_intent.succeeded':
        return {
          event: 'payment_succeeded',
          providerPaymentId: paymentIntent.id,
          metadata: (paymentIntent.metadata ?? {}) as Record<string, unknown>,
        }
      case 'payment_intent.payment_failed':
        return {
          event: 'payment_failed',
          providerPaymentId: paymentIntent.id,
          metadata: (paymentIntent.metadata ?? {}) as Record<string, unknown>,
        }
      default:
        // Return as succeeded with the ID so callers can decide what to do.
        // The webhook routes should filter for known event types.
        return {
          event: 'payment_succeeded',
          providerPaymentId: paymentIntent.id ?? '',
          metadata: { originalEventType: event.type },
        }
    }
  }
}
