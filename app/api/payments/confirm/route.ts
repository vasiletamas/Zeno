/**
 * Payment Confirmation API (D2.6 — settlement-inbox path)
 *
 * POST /api/payments/confirm — client-side confirmation after payment
 * GET  /api/payments/confirm — PayU redirect return URL
 *
 * Neither settles on the client's say-so: the provider's getPaymentStatus
 * is verified first (a payment without a providerPaymentId cannot be
 * verified → 409), then the VERIFIED outcome flows through the same
 * transactional inbox as webhooks, with a stable derived eventId so a
 * refresh/double-confirm replays instead of double-settling. Internal
 * failure → 5xx (never a swallowed 200).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getPaymentProvider } from '@/lib/payments'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { resolveReturnLookup } from '@/lib/payments/confirm-return-lookup'

const confirmBodySchema = z.object({
  paymentId: z.string(),
})

const PROVIDER_ENUM = { stripe: 'STRIPE', payu: 'PAYU', mock: 'MOCK' } as const

/**
 * POST handler — client-side confirmation, provider verification mandatory.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = confirmBodySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const { paymentId } = parsed.data
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } })
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }
    // T8.D3: never settle unverified — no provider reference, no settlement
    if (!payment.providerPaymentId) {
      return NextResponse.json(
        { error: 'Payment has no provider reference and cannot be verified' },
        { status: 409 },
      )
    }

    const provider = getPaymentProvider()
    const providerStatus = await provider.getPaymentStatus(payment.providerPaymentId)

    if (providerStatus.status === 'pending') {
      return NextResponse.json(
        { success: false, message: 'Payment still processing' },
        { status: 200 },
      )
    }

    const providerEnum = PROVIDER_ENUM[provider.name as keyof typeof PROVIDER_ENUM] ?? 'MOCK'
    if (providerStatus.status === 'failed') {
      await settlePaymentEvent({
        provider: providerEnum,
        // stable per (payment, outcome): a re-confirm replays, never re-marks
        eventId: `confirm:${payment.providerPaymentId}:failed`,
        event: 'payment_failed',
        providerPaymentId: payment.providerPaymentId,
        failureReason: providerStatus.failureReason ?? 'Payment failed at provider',
      })
      return NextResponse.json(
        { error: 'Payment failed', failureReason: providerStatus.failureReason },
        { status: 400 },
      )
    }

    // verified completed — settle through the inbox
    await settlePaymentEvent({
      provider: providerEnum,
      eventId: `confirm:${payment.providerPaymentId}:succeeded`,
      event: 'payment_succeeded',
      providerPaymentId: payment.providerPaymentId,
    })

    // policy status via the installment chain (created at first capture)
    const updatedPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { installment: { include: { schedule: { include: { quote: { include: { policy: { select: { status: true } } } } } } } } },
    })

    return NextResponse.json({
      success: true,
      policyStatus: updatedPayment?.installment.schedule.quote.policy?.status ?? 'PENDING_SUBMISSION',
    })
  } catch (error) {
    console.error('[PaymentConfirm] POST error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}

/**
 * GET handler — provider redirect return URL
 *
 * PayU's hosted page returns ?provider=payu&orderId=<providerPaymentId>;
 * the Stripe card's 3DS return_url sends ?provider=stripe&paymentId=<Payment
 * row id> (T30 — orderId-only reading broke every Stripe redirect return).
 * Same verified settlement path; safe for duplicate/refresh calls (the
 * derived eventId replays).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const lookup = resolveReturnLookup(url.searchParams)

    if (lookup.by === 'none') {
      return NextResponse.json(
        { error: 'Missing orderId or paymentId parameter' },
        { status: 400 },
      )
    }

    const payment = lookup.by === 'orderId'
      ? await prisma.payment.findUnique({ where: { providerPaymentId: lookup.providerPaymentId } })
      : await prisma.payment.findUnique({ where: { id: lookup.paymentId } })

    const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
    // T8.D3: no provider reference, no settlement — same wall as POST
    if (!payment?.providerPaymentId) {
      console.error(`[PaymentConfirm] GET: no verifiable payment for ${lookup.by}=${lookup.by === 'orderId' ? lookup.providerPaymentId : lookup.paymentId}`)
      // Redirect to home with error — don't expose internal details
      return NextResponse.redirect(`${appUrl}/?payment=error`)
    }
    const providerPaymentId = payment.providerPaymentId

    // Verify status with the payment provider — the redirect itself proves
    // nothing (T8.D3)
    const provider = getPaymentProvider()
    const providerStatus = await provider.getPaymentStatus(providerPaymentId)
    const providerEnum = PROVIDER_ENUM[provider.name as keyof typeof PROVIDER_ENUM] ?? 'MOCK'

    if (providerStatus.status === 'failed') {
      await settlePaymentEvent({
        provider: providerEnum,
        eventId: `confirm:${providerPaymentId}:failed`,
        event: 'payment_failed',
        providerPaymentId,
        failureReason: providerStatus.failureReason ?? 'Payment failed at provider',
      })
      return NextResponse.redirect(`${appUrl}/?payment=failed`)
    }
    if (providerStatus.status === 'pending') {
      return NextResponse.redirect(`${appUrl}/?payment=pending`)
    }

    await settlePaymentEvent({
      provider: providerEnum,
      eventId: `confirm:${providerPaymentId}:succeeded`,
      event: 'payment_succeeded',
      providerPaymentId,
    })

    // Find conversationId via Payment → Installment → Schedule → Quote →
    // Application → originConversationId
    const paymentWithRelations = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: {
        installment: {
          include: {
            schedule: {
              include: {
                quote: {
                  include: {
                    application: { select: { originConversationId: true } },
                  },
                },
              },
            },
          },
        },
      },
    })

    const conversationId =
      paymentWithRelations?.installment.schedule.quote.application?.originConversationId

    if (conversationId) {
      return NextResponse.redirect(
        `${appUrl}/chat/${conversationId}?payment=success`,
      )
    }

    // Fallback if conversation not found
    return NextResponse.redirect(`${appUrl}/?payment=success`)
  } catch (error) {
    console.error('[PaymentConfirm] GET error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  }
}
