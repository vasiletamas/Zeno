/**
 * Stripe Webhook Handler (D2.7 — settlement-inbox path)
 *
 * POST /api/webhooks/stripe
 *
 * IMPORTANT: Uses request.text() for raw body — Stripe signature
 * validation requires the original unmodified payload string.
 *
 * Verified events flow through the transactional settlement inbox
 * (exactly-once on stripe's event.id). 'ignored' and unmatched events are
 * acknowledged with 200; INTERNAL failures return 5xx so Stripe retries
 * (T8.D3 — the old 200-swallow silently dropped money events).
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getPaymentProvider } from '@/lib/payments'
import { settlePaymentEvent, recordPaymentAnomaly } from '@/lib/payments/settlement'

export async function POST(request: Request) {
  let webhookEvent
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

    const provider = getPaymentProvider()
    if (provider.name !== 'stripe') {
      console.warn(
        '[StripeWebhook] Received webhook but active provider is not Stripe',
      )
      return NextResponse.json({ received: true }, { status: 200 })
    }

    try {
      webhookEvent = await provider.handleWebhook(rawBody, signature)
    } catch (error) {
      console.error(
        '[StripeWebhook] Signature validation failed:',
        error instanceof Error ? error.message : error,
      )
      // D2.ADD-1: signature failures never reach the inbox — flag once per
      // payload so an operator sees possible forgery attempts.
      await recordPaymentAnomaly({
        anomaly: 'bad_signature',
        ref: `STRIPE:${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 16)}`,
        reason: `bad_signature: Stripe webhook rejected — ${error instanceof Error ? error.message : 'validation failed'}`,
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 },
      )
    }

    if (webhookEvent.event === 'ignored') {
      console.log(
        `[StripeWebhook] Ignoring event ${webhookEvent.eventId} (${String(webhookEvent.metadata?.originalEventType ?? 'unknown type')})`,
      )
      return NextResponse.json({ received: true }, { status: 200 })
    }

    const result = await settlePaymentEvent({
      provider: 'STRIPE',
      eventId: webhookEvent.eventId,
      event: webhookEvent.event,
      providerPaymentId: webhookEvent.providerPaymentId,
      failureReason: webhookEvent.metadata?.failureReason as string | undefined,
    })

    if (result.disposition === 'unmatched') {
      // Not one of ours — acknowledge so Stripe stops retrying.
      console.log(
        `[StripeWebhook] No payment for providerPaymentId=${webhookEvent.providerPaymentId}, recorded + ignored`,
      )
    }
    return NextResponse.json({ received: true, disposition: result.disposition }, { status: 200 })
  } catch (error) {
    console.error('[StripeWebhook] Internal processing error:', error)
    // 5xx so Stripe RETRIES — a verified money event must never be dropped.
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
