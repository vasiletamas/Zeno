/**
 * PayU Webhook (IPN) Handler
 *
 * POST /api/webhooks/payu
 *
 * Receives PayU Instant Payment Notification (IPN) callbacks.
 * PayU sends notifications when order status changes.
 *
 * PayU expects a specific acknowledgment response.
 * Unknown or missing payments are acknowledged (200) to prevent retries.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getPaymentProvider } from '@/lib/payments'
import { runPostPaymentFlow } from '@/lib/payments/post-payment'

export async function POST(request: Request) {
  try {
    // PayU can send JSON or form-encoded depending on configuration.
    // Read as text first, then parse.
    const rawBody = await request.text()

    const signature = request.headers.get('OpenPayU-Signature') ?? ''

    // Parse and validate webhook via PayU provider
    const provider = getPaymentProvider()
    if (provider.name !== 'payu') {
      console.warn(
        '[PayUWebhook] Received webhook but active provider is not PayU',
      )
      return NextResponse.json({ status: 'OK' }, { status: 200 })
    }

    let webhookEvent
    try {
      webhookEvent = await provider.handleWebhook(rawBody, signature)
    } catch (error) {
      console.error(
        '[PayUWebhook] Webhook validation failed:',
        error instanceof Error ? error.message : error,
      )
      return NextResponse.json(
        { error: 'Webhook validation failed' },
        { status: 400 },
      )
    }

    // Find payment by provider payment ID
    const payment = await prisma.payment.findFirst({
      where: { providerPaymentId: webhookEvent.providerPaymentId },
    })

    if (!payment) {
      // Payment not in our DB — acknowledge to prevent retries
      console.log(
        `[PayUWebhook] No payment found for providerPaymentId=${webhookEvent.providerPaymentId}, ignoring`,
      )
      return NextResponse.json({ status: 'OK' }, { status: 200 })
    }

    // Process the event
    if (webhookEvent.event === 'payment_succeeded') {
      console.log(
        `[PayUWebhook] Payment succeeded: ${payment.id} (provider: ${webhookEvent.providerPaymentId})`,
      )
      await runPostPaymentFlow(payment.id)
    } else if (webhookEvent.event === 'payment_failed') {
      console.log(
        `[PayUWebhook] Payment failed: ${payment.id} (provider: ${webhookEvent.providerPaymentId})`,
      )
      const failureReason =
        (webhookEvent.metadata?.status as string) ??
        'Payment failed via PayU webhook'

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failureReason,
        },
      })
    }

    // PayU expects acknowledgment
    return NextResponse.json({ status: 'OK' }, { status: 200 })
  } catch (error) {
    console.error('[PayUWebhook] Unhandled error:', error)
    // Return 200 to prevent PayU retries for consistently failing webhooks.
    return NextResponse.json(
      { status: 'OK', error: 'Internal processing error' },
      { status: 200 },
    )
  }
}
