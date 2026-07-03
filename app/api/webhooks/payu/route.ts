/**
 * PayU Webhook (IPN) Handler (D2.7 — settlement-inbox path)
 *
 * POST /api/webhooks/payu
 *
 * Unsigned payloads are hard-rejected by the provider (400). Verified
 * events flow through the transactional settlement inbox — exactly-once on
 * the derived (orderId:status) event identity. 'ignored' (PENDING) and
 * unmatched events are acknowledged with 200; INTERNAL failures return 5xx
 * so PayU retries (T8.D3 — never silently drop a money event).
 */

import { NextResponse } from 'next/server'
import { getPaymentProvider } from '@/lib/payments'
import { settlePaymentEvent } from '@/lib/payments/settlement'

export async function POST(request: Request) {
  try {
    // PayU can send JSON or form-encoded depending on configuration.
    // Read as text first, then parse.
    const rawBody = await request.text()

    const signature = request.headers.get('OpenPayU-Signature') ?? ''

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

    if (webhookEvent.event === 'ignored') {
      console.log(`[PayUWebhook] Ignoring event ${webhookEvent.eventId}`)
      return NextResponse.json({ status: 'OK' }, { status: 200 })
    }

    const result = await settlePaymentEvent({
      provider: 'PAYU',
      eventId: webhookEvent.eventId,
      event: webhookEvent.event,
      providerPaymentId: webhookEvent.providerPaymentId,
      failureReason: webhookEvent.metadata?.status as string | undefined,
    })

    if (result.disposition === 'unmatched') {
      console.log(
        `[PayUWebhook] No payment for providerPaymentId=${webhookEvent.providerPaymentId}, recorded + ignored`,
      )
    }

    // PayU expects acknowledgment
    return NextResponse.json({ status: 'OK', disposition: result.disposition }, { status: 200 })
  } catch (error) {
    console.error('[PayUWebhook] Internal processing error:', error)
    // 5xx so PayU RETRIES — a verified money event must never be dropped.
    return NextResponse.json({ error: 'processing_failed' }, { status: 500 })
  }
}
