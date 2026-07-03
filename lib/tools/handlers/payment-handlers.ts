/**
 * Payment Tool Handlers
 *
 * Handles the initiate_payment tool which creates a PaymentIntent
 * via the configured payment provider and returns a show_payment
 * UI action for inline checkout in the chat.
 */

import { getPaymentProvider } from '@/lib/payments'
import type { ToolHandler, ToolResult } from '@/lib/tools/types'
import { logError } from '@/lib/errors/logger'

/**
 * initiate_payment — Creates a payment intent and returns the PaymentCard UI.
 *
 * 1. Find PENDING_SUBMISSION policy from context or DB chain
 * 2. Calculate amount in smallest currency unit (bani)
 * 3. Create PaymentIntent via provider
 * 4. Create Payment record in DB
 * 5. Return uiAction: show_payment
 */
export const initiatePayment: ToolHandler = async (
  _args,
  context,
): Promise<ToolResult> => {
  try {
    // ─── Step 1: Find policy ───────────────────────────────
    let policyId = context.policy?.id
    let policyStatus = context.policy?.status
    let premiumMonthly = context.policy?.premiumMonthly ?? 0
    let premiumAnnual = context.policy?.premiumAnnual ?? 0
    let paymentFrequency = context.policy?.paymentFrequency ?? null

    // If not in context, query the DB chain
    if (!policyId) {
      // B4: the application hangs off the activeApplicationId pointer
      const conversation = await context.db.conversation.findUnique({
        where: { id: context.conversationId },
        select: { activeApplicationId: true },
      })
      const application = conversation?.activeApplicationId
        ? await context.db.application.findUnique({
            where: { id: conversation.activeApplicationId },
            include: { quote: { include: { policy: true } } },
          })
        : null

      const policy = application?.quote?.policy
      if (!policy) {
        return {
          success: false,
          error: 'No policy found for this conversation. A quote must be accepted first.',
        }
      }

      policyId = policy.id
      policyStatus = policy.status
      premiumMonthly = policy.premiumMonthly
      premiumAnnual = policy.premiumAnnual
      paymentFrequency = policy.paymentFrequency
    }

    // Must be PENDING_SUBMISSION
    if (policyStatus !== 'PENDING_SUBMISSION') {
      return {
        success: false,
        error: `Policy is in "${policyStatus}" status. Payment can only be initiated for PENDING_SUBMISSION policies.`,
      }
    }

    // ─── Step 2: Calculate amount ──────────────────────────
    // Amount in smallest currency unit (RON bani = amount * 100)
    let amount: number
    let description: string

    if (paymentFrequency === 'annual') {
      amount = Math.round(premiumAnnual * 100)
      description = `Annual premium payment`
    } else {
      // Default to monthly (first month payment)
      amount = Math.round(premiumMonthly * 100)
      description = `Monthly premium payment`
    }

    const currency = 'RON'

    // ─── Step 3: Create PaymentIntent ──────────────────────
    const provider = getPaymentProvider()

    const paymentIntent = await provider.createPaymentIntent({
      amount,
      currency,
      customerId: context.customerId,
      policyId,
      description,
    })

    // ─── Step 4: Create Payment record ─────────────────────
    // D2.1 re-anchor: a Payment settles an INSTALLMENT of the quote's
    // schedule (contradiction #3). Until D2.5 creates the schedule at
    // acceptance, none may exist yet — D2.8 finishes this re-anchor.
    const providerEnum = provider.name.toUpperCase() as 'STRIPE' | 'PAYU' | 'MOCK'

    const policyRow = await context.db.policy.findUniqueOrThrow({ where: { id: policyId }, select: { quoteId: true } })
    const schedule = await context.db.paymentSchedule.findFirst({
      where: { quoteId: policyRow.quoteId, status: { in: ['PENDING_FIRST_CAPTURE', 'ACTIVE'] } },
      include: { installments: { where: { status: 'PENDING' }, orderBy: { sequence: 'asc' }, take: 1 } },
    })
    const installment = schedule?.installments[0]
    if (!installment) {
      return {
        success: false,
        error: 'payment_not_pending: no payment schedule with a pending installment exists for this quote.',
      }
    }

    const payment = await context.db.payment.create({
      data: {
        installmentId: installment.id,
        customerId: context.customerId,
        amountMinor: amount,
        currency,
        provider: providerEnum,
        providerPaymentId: paymentIntent.providerPaymentId,
        status: 'PENDING',
      },
    })

    // ─── Step 5: Build policy description for UI ───────────
    // Load tier/level names for display
    const policy = await context.db.policy.findUnique({
      where: { id: policyId },
      include: {
        quote: {
          include: {
            application: {
              include: {
                tier: true,
                level: true,
              },
            },
          },
        },
      },
    })

    const tier = policy?.quote?.application?.tier
    const level = policy?.quote?.application?.level
    const includesAddon = policy?.quote?.application?.includesAddon ?? false

    const tierName = tier?.name as Record<string, string> | null
    const levelName = level?.name as Record<string, string> | null
    const lang = context.language

    const policyDescription = [
      tierName?.[lang] ?? tierName?.ro ?? '',
      levelName?.[lang] ?? levelName?.ro ?? '',
      includesAddon ? '+ BD' : '',
    ]
      .filter(Boolean)
      .join(' ')

    // ─── Step 6: Return result ─────────────────────────────
    // Display amount in RON (not bani)
    const displayAmount = amount / 100

    return {
      success: true,
      data: {
        paymentId: payment.id,
        amount: displayAmount,
        currency,
        providerName: provider.name,
      },
      message: 'Payment initiated',
      uiAction: {
        type: 'show_payment',
        payload: {
          clientSecret: paymentIntent.clientSecret,
          amount: displayAmount,
          currency,
          providerName: provider.name,
          paymentId: payment.id,
          policyDescription,
          redirectUrl: paymentIntent.redirectUrl ?? null,
        },
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logError({
      layer: 'tool',
      category: 'initiate_payment',
      message: `Payment initiation failed: ${message}`,
      context: { conversationId: context.conversationId, customerId: context.customerId },
      error,
    })
    return {
      success: false,
      error: `Failed to initiate payment: ${message}`,
    }
  }
}
