/**
 * Stripe Webhook Handler
 *
 * POST /api/webhooks/stripe
 *
 * Receives Stripe webhook events and processes payment outcomes.
 * IMPORTANT: Uses request.text() for raw body — Stripe signature
 * validation requires the original unmodified payload string.
 *
 * Unknown event types are acknowledged with 200 (not 4xx)
 * to prevent Stripe from retrying them.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getPaymentProvider } from '@/lib/payments'
import { runPostPaymentFlow } from '@/lib/payments/post-payment'

export async function POST(request: Request) {
  try {
    // CRITICAL: Read raw body as text, NOT JSON.
    // Stripe signature validation requires the exact bytes.
    const rawBody = await request.text()

    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 },
      )
    }

    // Parse and validate webhook event via Stripe provider
    const provider = getPaymentProvider()
    if (provider.name !== 'stripe') {
      console.warn(
        '[StripeWebhook] Received webhook but active provider is not Stripe',
      )
      return NextResponse.json({ received: true }, { status: 200 })
    }

    let webhookEvent
    try {
      webhookEvent = await provider.handleWebhook(rawBody, signature)
    } catch (error) {
      console.error(
        '[StripeWebhook] Signature validation failed:',
        error instanceof Error ? error.message : error,
      )
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 },
      )
    }

    // Check for unrecognized event types (handleWebhook returns with
    // metadata.originalEventType for unknown types)
    if (webhookEvent.metadata?.originalEventType) {
      console.log(
        `[StripeWebhook] Ignoring event type: ${webhookEvent.metadata.originalEventType as string}`,
      )
      return NextResponse.json({ received: true }, { status: 200 })
    }

    // Find payment by provider payment ID
    const payment = await prisma.payment.findFirst({
      where: { providerPaymentId: webhookEvent.providerPaymentId },
    })

    if (!payment) {
      // Payment not in our DB — might be for a different integration.
      // Acknowledge to prevent retries.
      console.log(
        `[StripeWebhook] No payment found for providerPaymentId=${webhookEvent.providerPaymentId}, ignoring`,
      )
      return NextResponse.json({ received: true }, { status: 200 })
    }

    // Process the event
    if (webhookEvent.event === 'payment_succeeded') {
      console.log(
        `[StripeWebhook] Payment succeeded: ${payment.id} (provider: ${webhookEvent.providerPaymentId})`,
      )
      await runPostPaymentFlow(payment.id)
    } else if (webhookEvent.event === 'payment_failed') {
      console.log(
        `[StripeWebhook] Payment failed: ${payment.id} (provider: ${webhookEvent.providerPaymentId})`,
      )
      const failureReason =
        (webhookEvent.metadata?.failureReason as string) ??
        'Payment failed via Stripe webhook'

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason,
        },
      })
    }

    return NextResponse.json({ received: true }, { status: 200 })
  } catch (error) {
    console.error('[StripeWebhook] Unhandled error:', error)
    // Return 200 even on internal errors to prevent Stripe retries
    // that would keep failing. Log the error for investigation.
    return NextResponse.json(
      { received: true, error: 'Internal processing error' },
      { status: 200 },
    )
  }
}
