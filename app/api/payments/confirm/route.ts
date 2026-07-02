/**
 * Payment Confirmation API
 *
 * POST /api/payments/confirm — Client-side confirmation after payment
 * GET  /api/payments/confirm — PayU redirect return URL
 *
 * Both call runPostPaymentFlow() which is idempotent (atomic CAS).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getPaymentProvider } from '@/lib/payments'
import { runPostPaymentFlow } from '@/lib/payments/post-payment'

const confirmBodySchema = z.object({
  paymentId: z.string(),
})

/**
 * POST handler — Client-side confirmation
 *
 * Called by PaymentCard after Stripe.confirmPayment() succeeds
 * or after mock provider simulates payment.
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

    // Load payment record
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    })

    if (!payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 },
      )
    }

    // Verify status with payment provider
    const provider = getPaymentProvider()

    if (payment.providerPaymentId) {
      const providerStatus = await provider.getPaymentStatus(
        payment.providerPaymentId,
      )

      if (providerStatus.status === 'pending') {
        return NextResponse.json(
          { success: false, message: 'Payment still processing' },
          { status: 200 },
        )
      }

      if (providerStatus.status === 'failed') {
        await prisma.payment.update({
          where: { id: paymentId },
          data: {
            status: 'FAILED',
            failureReason:
              providerStatus.failureReason ?? 'Payment failed at provider',
          },
        })

        return NextResponse.json(
          {
            error: 'Payment failed',
            failureReason: providerStatus.failureReason,
          },
          { status: 400 },
        )
      }
    }

    // Provider says completed (or mock) — run post-payment flow
    const result = await runPostPaymentFlow(paymentId)

    // Load updated policy status
    const updatedPayment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { policy: { select: { status: true } } },
    })

    return NextResponse.json({
      success: true,
      policyStatus: updatedPayment?.policy.status ?? 'SUBMITTED',
      emailSent: result.emailSent,
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
 * GET handler — PayU redirect return URL
 *
 * PayU redirects the customer back here after payment on their hosted page.
 * URL format: /api/payments/confirm?provider=payu&orderId=...
 *
 * This triggers side effects (post-payment flow), but idempotency guard
 * makes it safe for duplicate/refresh calls.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const orderId = url.searchParams.get('orderId')
    const providerParam = url.searchParams.get('provider')

    if (!orderId) {
      return NextResponse.json(
        { error: 'Missing orderId parameter' },
        { status: 400 },
      )
    }

    // Find payment by provider payment ID
    const payment = await prisma.payment.findFirst({
      where: { providerPaymentId: orderId },
    })

    if (!payment) {
      console.error(
        `[PaymentConfirm] GET: Payment not found for orderId=${orderId}`,
      )
      // Redirect to home with error — don't expose internal details
      const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
      return NextResponse.redirect(`${appUrl}/?payment=error`)
    }

    // Verify status with payment provider
    if (providerParam === 'payu' || providerParam === 'stripe') {
      const provider = getPaymentProvider()
      const providerStatus = await provider.getPaymentStatus(orderId)

      if (providerStatus.status === 'failed') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason:
              providerStatus.failureReason ?? 'Payment failed at provider',
          },
        })

        const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
        return NextResponse.redirect(`${appUrl}/?payment=failed`)
      }
    }

    // Run post-payment flow (idempotent — safe for duplicates)
    await runPostPaymentFlow(payment.id)

    // Find conversationId via Payment → Policy → Quote → Application → conversationId
    const paymentWithRelations = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: {
        policy: {
          include: {
            quote: {
              include: {
                application: {
                  select: { originConversationId: true },
                },
              },
            },
          },
        },
      },
    })

    const conversationId =
      paymentWithRelations?.policy?.quote?.application?.originConversationId

    const appUrl = process.env.APP_URL ?? 'http://localhost:3001'

    if (conversationId) {
      return NextResponse.redirect(
        `${appUrl}/chat/${conversationId}?payment=success`,
      )
    }

    // Fallback if conversation not found
    return NextResponse.redirect(`${appUrl}/?payment=success`)
  } catch (error) {
    console.error('[PaymentConfirm] GET error:', error)
    const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
    return NextResponse.redirect(`${appUrl}/?payment=error`)
  }
}
