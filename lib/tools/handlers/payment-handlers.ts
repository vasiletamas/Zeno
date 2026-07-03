/**
 * Payment Tool Handlers (D2.8 — schedule-anchored, interim until D3)
 *
 * initiate_payment reads the SCHEDULE, never a Policy: the policy does not
 * exist until the first successful settlement (contradiction #5). The
 * amount is the due installment's integer minor units — the annual-vs-
 * monthly branch and the premiumMonthly fallback died with the re-anchor
 * (contradiction #3: the schedule is the live money truth).
 */

import { getPaymentProvider } from '@/lib/payments'
import type { ToolHandler, ToolResult } from '@/lib/tools/types'
import { logError } from '@/lib/errors/logger'

export const initiatePayment: ToolHandler = async (
  _args,
  context,
): Promise<ToolResult> => {
  try {
    // ─── Resolve conversation → application → accepted quote ───
    const conversation = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
      select: { activeApplicationId: true },
    })
    const application = conversation?.activeApplicationId
      ? await context.db.application.findUnique({
          where: { id: conversation.activeApplicationId },
          include: { tier: true, level: true },
        })
      : null
    if (!application) {
      return { success: false, error: 'payment_not_pending: no application found — accept a quote first.' }
    }
    const quote = await context.db.quote.findFirst({
      where: { applicationId: application.id, status: 'ACCEPTED' },
      orderBy: { createdAt: 'desc' },
    })
    if (!quote) {
      return { success: false, error: 'payment_not_pending: no accepted quote — payment starts at acceptance.' }
    }

    // ─── The live schedule and its first due installment ───────
    const schedule = await context.db.paymentSchedule.findFirst({
      where: { quoteId: quote.id, status: { in: ['PENDING_FIRST_CAPTURE', 'ACTIVE'] } },
      include: { installments: { where: { status: 'PENDING' }, orderBy: { sequence: 'asc' }, take: 1 } },
      orderBy: { createdAt: 'desc' },
    })
    const installment = schedule?.installments[0]
    if (!schedule || !installment) {
      return { success: false, error: 'no_due_installment: the schedule has no pending installment to pay.' }
    }

    const amountMinor = installment.amountMinor
    const currency = schedule.currency

    // ─── Create PaymentIntent via the provider ──────────────────
    const provider = getPaymentProvider()
    const paymentIntent = await provider.createPaymentIntent({
      amount: amountMinor,
      currency,
      customerId: context.customerId,
      policyId: schedule.quoteId, // provider input field name stays until D3's interface pass
      description: `Installment ${installment.sequence}/${schedule.totalInstallments}`,
    })

    const providerEnum = provider.name.toUpperCase() as 'STRIPE' | 'PAYU' | 'MOCK'
    const payment = await context.db.payment.create({
      data: {
        installmentId: installment.id,
        customerId: context.customerId,
        amountMinor,
        currency,
        provider: providerEnum,
        providerPaymentId: paymentIntent.providerPaymentId,
        status: 'PENDING',
      },
    })

    // ─── Description for the payment card ──────────────────────
    const tierName = application.tier?.name as Record<string, string> | null
    const levelName = application.level?.name as Record<string, string> | null
    const lang = context.language
    const policyDescription = [
      tierName?.[lang] ?? tierName?.ro ?? '',
      levelName?.[lang] ?? levelName?.ro ?? '',
      application.includesAddon ? '+ BD' : '',
    ]
      .filter(Boolean)
      .join(' ')

    const displayAmount = amountMinor / 100

    return {
      success: true,
      data: {
        paymentId: payment.id,
        amount: displayAmount,
        currency,
        installmentSequence: installment.sequence,
        totalInstallments: schedule.totalInstallments,
        providerName: provider.name,
      },
      message: `Payment initiated for installment ${installment.sequence}/${schedule.totalInstallments} (${displayAmount.toFixed(2)} ${currency}).`,
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
