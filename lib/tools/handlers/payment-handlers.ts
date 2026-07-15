/**
 * Payment Tool Handlers (D3 — the schedule substrate is the only money truth)
 *
 * get_payment_status: the ONLY payment read (contradiction #3).
 * ensure_payment_session: ONE commit replacing initiate/resume/retry
 * (T8.D4) — engine-determined mode, single open attempt structurally.
 * change_payment_option: pre-capture re-rating by superseding the schedule,
 * never mutating the accepted Quote (T8.D5).
 * No Quote money field is ever read here; no Policy prerequisite exists
 * (the policy is born at first capture — contradiction #5).
 */

import { getPaymentProvider } from '@/lib/payments'
import { deriveSchedulePosition } from '@/lib/engines/payment-position'
import { buildSchedule, type PaymentFrequency } from '@/lib/engines/payment-schedule'
import type { ToolHandler, ToolResult } from '@/lib/tools/types'
import type { ToolContext } from '@/lib/tools/types'
import { logError } from '@/lib/errors/logger'

/**
 * The customer's LIVE (non-superseded) schedule with installments and
 * attempts — conversation→application→quote chain first, customer-scoped
 * fallback for returning users (D3.2).
 */
async function loadLiveSchedule(context: ToolContext) {
  const conversation = await context.db.conversation.findUnique({
    where: { id: context.conversationId },
    select: { activeApplicationId: true },
  })
  const quote = conversation?.activeApplicationId
    ? await context.db.quote.findFirst({
        where: { applicationId: conversation.activeApplicationId, status: 'ACCEPTED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      })
    : null
  return context.db.paymentSchedule.findFirst({
    where: {
      status: { in: ['PENDING_FIRST_CAPTURE', 'ACTIVE', 'COMPLETED'] },
      ...(quote ? { quoteId: quote.id } : { customerId: context.customerId }),
    },
    include: { installments: { orderBy: { sequence: 'asc' }, include: { payments: { orderBy: { createdAt: 'desc' } } } } },
    orderBy: { createdAt: 'desc' },
  })
}

// ─────────────────────────────────────────────
// get_payment_status (D3.2) — the ONLY payment read; answers exclusively
// from PaymentSchedule/Installment/Payment state (contradiction #3 — no
// Quote money field is ever read, only the relation key).
// ─────────────────────────────────────────────

export const getPaymentStatus: ToolHandler = async (_args, context) => {
  try {
    const schedule = await loadLiveSchedule(context)
    if (!schedule) {
      return { success: false, error: 'payment_not_pending: no payment schedule exists — payment starts at quote acceptance.' }
    }
    const payments = schedule.installments.flatMap((i) => i.payments)
    const pos = deriveSchedulePosition({
      installments: schedule.installments,
      payments,
      now: new Date(),
    })
    const lastFailure = payments.filter((p) => p.status === 'FAILED').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    return {
      success: true,
      data: {
        frequency: schedule.frequency,
        status: schedule.status,
        currency: schedule.currency,
        installments: schedule.installments.map((i) => ({ sequence: i.sequence, dueAt: i.dueAt.toISOString(), amountMinor: i.amountMinor, status: i.status })),
        nextDue: pos.nextDue ? { sequence: pos.nextDue.sequence, amountMinor: pos.nextDue.amountMinor, dueAt: pos.nextDue.dueAt.toISOString() } : null,
        capturedCount: pos.capturedCount,
        settled: pos.settled,
        recoveryMode: pos.recoveryMode,
        openAttemptStale: pos.openAttemptStale,
        lastFailureReason: lastFailure?.failureReason ?? null,
      },
      message: pos.settled
        ? `Payment plan settled: ${pos.capturedCount}/${schedule.totalInstallments} installments paid.`
        : `Payment plan ${schedule.frequency}: ${pos.capturedCount}/${schedule.totalInstallments} paid, next due ${(pos.nextDue!.amountMinor / 100).toFixed(2)} ${schedule.currency}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * ensure_payment_session (D3.3, T8.D4) — ONE commit replaces the
 * initiate/resume/retry trio. The mode (started|resumed|retried) is ENGINE
 * OUTPUT from deriveSchedulePosition, never input. Single-open-attempt is
 * structural: a fresh non-stale open intent is RESUMED (the canonical
 * session), a stale one is provider-cancelled and marked SUPERSEDED before a
 * fresh intent is created — capturable sessions never stack (the live
 * double-charge surface is closed). REPLAY_EXEMPT in the gateway (D3
 * erratum 1): the apply IS the idempotency mechanism.
 */
export const ensurePaymentSession: ToolHandler = async (
  _args,
  context,
): Promise<ToolResult> => {
  try {
    const schedule = await loadLiveSchedule(context)
    if (!schedule || schedule.status === 'COMPLETED') {
      return { success: false, error: schedule ? 'no_due_installment: the payment plan is fully settled.' : 'payment_not_pending: no payment schedule exists — accept a quote first.' }
    }
    const payments = schedule.installments.flatMap((i) => i.payments)
    const pos = deriveSchedulePosition({ installments: schedule.installments, payments, now: new Date() })
    if (!pos.nextDue) {
      return { success: false, error: 'no_due_installment: the schedule has no pending installment to pay.' }
    }
    const provider = getPaymentProvider()

    if (pos.openAttempt && !pos.openAttemptStale) {
      // the canonical open session — resume it with a USABLE credential
      // (P1-5). Re-fetch a live credential from the provider; fall back to the
      // credential persisted at create time (PayU cannot re-issue its hosted
      // page URL). A terminally-unusable intent is superseded below.
      const openRow = await context.db.payment.findUnique({ where: { id: pos.openAttempt.id } })
      const persisted = (openRow?.metadata ?? {}) as { clientSecret?: string | null; redirectUrl?: string | null }
      const live = pos.openAttempt.providerPaymentId
        ? await provider.retrievePaymentIntent(pos.openAttempt.providerPaymentId).catch(() => null)
        : null
      const usable = live ? live.usable : true // no-retrieve providers → assume usable
      const clientSecret = live?.clientSecret ?? persisted.clientSecret ?? null
      const redirectUrl = live?.redirectUrl ?? persisted.redirectUrl ?? null
      const hasCredential = provider.name === 'payu' ? redirectUrl !== null : clientSecret !== null
      if (usable && hasCredential) {
        return {
          success: true,
          data: { mode: 'resumed', paymentId: pos.openAttempt.id, amountMinor: pos.nextDue.amountMinor, installmentSequence: pos.nextDue.sequence, totalInstallments: schedule.totalInstallments },
          message: `Resuming the open payment session for installment ${pos.nextDue.sequence}/${schedule.totalInstallments}.`,
          uiAction: {
            type: 'show_payment',
            payload: { clientSecret, redirectUrl, amount: pos.nextDue.amountMinor / 100, currency: schedule.currency, providerName: provider.name, paymentId: pos.openAttempt.id, mode: 'resumed' },
          },
        }
      }
      // unusable or no recoverable credential → supersede and mint a fresh one
      if (pos.openAttempt.providerPaymentId) {
        await provider.cancelPaymentIntent(pos.openAttempt.providerPaymentId).catch(() => {})
        await context.db.payment.updateMany({
          where: { providerPaymentId: pos.openAttempt.providerPaymentId, status: 'PENDING' },
          data: { status: 'SUPERSEDED' },
        })
      }
    }

    if (pos.openAttempt && pos.openAttemptStale && pos.openAttempt.providerPaymentId) {
      // stale: supersede — cancel at the provider, mark SUPERSEDED
      await provider.cancelPaymentIntent(pos.openAttempt.providerPaymentId)
      await context.db.payment.updateMany({
        where: { providerPaymentId: pos.openAttempt.providerPaymentId, status: 'PENDING' },
        data: { status: 'SUPERSEDED' },
      })
    }

    // the intent is created before the gateway transaction commits — a
    // failure after this point cancels it so no orphan capturable session
    // survives a rollback
    const intent = await provider.createPaymentIntent({
      amount: pos.nextDue.amountMinor,
      currency: schedule.currency,
      customerId: context.customerId,
      referenceId: schedule.id,
      description: `Installment ${pos.nextDue.sequence}/${schedule.totalInstallments}`,
    })
    try {
      const payment = await context.db.payment.create({
        data: {
          installmentId: pos.nextDue.id,
          customerId: context.customerId,
          amountMinor: pos.nextDue.amountMinor,
          currency: schedule.currency,
          provider: provider.name.toUpperCase() as 'STRIPE' | 'PAYU' | 'MOCK',
          providerPaymentId: intent.providerPaymentId,
          status: 'PENDING',
          // P1-5: persist the create-time credential so a RESUME can re-supply
          // it (PayU's hosted-page URL cannot be re-fetched from the provider).
          metadata: { clientSecret: intent.clientSecret ?? null, redirectUrl: intent.redirectUrl ?? null },
        },
      })
      const mode = pos.recoveryMode === 'resumed' ? 'started' : pos.recoveryMode
      return {
        success: true,
        data: { mode, paymentId: payment.id, amountMinor: payment.amountMinor, installmentSequence: pos.nextDue.sequence, totalInstallments: schedule.totalInstallments },
        message: `Payment session ${mode} for installment ${pos.nextDue.sequence}/${schedule.totalInstallments} (${(payment.amountMinor / 100).toFixed(2)} ${schedule.currency}).`,
        uiAction: {
          type: 'show_payment',
          payload: { clientSecret: intent.clientSecret, redirectUrl: intent.redirectUrl ?? null, amount: payment.amountMinor / 100, currency: schedule.currency, providerName: provider.name, paymentId: payment.id, mode },
        },
      }
    } catch (dbError) {
      // DB write failed inside the gateway tx — cancel the just-created
      // intent so the rollback leaves no capturable orphan at the provider
      await provider.cancelPaymentIntent(intent.providerPaymentId).catch(() => {})
      throw dbError
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logError({
      layer: 'tool',
      category: 'ensure_payment_session',
      message: `ensure_payment_session failed: ${message}`,
      context: { conversationId: context.conversationId, customerId: context.customerId },
      error,
    })
    // keepWrites (P0-2 audit): a stale/unusable attempt already cancelled at
    // the provider was marked SUPERSEDED before this failure — that mark must
    // survive the rollback so the DB matches the provider (no orphan PENDING
    // pointing at a cancelled intent). The failed fresh create compensates its
    // own new intent, so nothing capturable leaks.
    return { success: false, error: `Failed to ensure payment session: ${message}`, keepWrites: true }
  }
}

/**
 * change_payment_option (D3.4, T8.D5) — pre-capture re-rating ONLY. The new
 * installment rows come from the SAME pure schedule engine fed the quote's
 * acceptance-priced premiumAnnual; the old schedule is retained SUPERSEDED
 * for audit (supersededById chain) and the accepted Quote is NEVER mutated
 * (contradiction #3: acceptance evidence is immutable). Any open payment
 * intent is provider-cancelled and superseded first. requires_confirmation
 * rides the gateway two-step; legality (capturedCount === 0) lives in the
 * engine rule.
 */
export const changePaymentOption: ToolHandler = async (args, context) => {
  try {
    const paymentOption = args.paymentOption as PaymentFrequency
    const schedule = await loadLiveSchedule(context)
    if (!schedule) {
      return { success: false, error: 'payment_not_pending: no payment schedule exists — accept a quote first.' }
    }
    // belt — legality is the wall (engine rule, capturedCount === 0)
    if (schedule.installments.some((i) => i.status === 'PAID')) {
      return { success: false, error: 'schedule_already_captured: the first installment was already captured — the frequency is fixed for this plan.' }
    }
    const quote = await context.db.quote.findUniqueOrThrow({ where: { id: schedule.quoteId }, include: { product: { select: { paymentFrequencyOptions: true } } } })
    const offered = Object.keys((quote.product.paymentFrequencyOptions as Record<string, unknown> | null) ?? {})
    if (!offered.includes(paymentOption)) {
      return { success: false, error: `invalid_args: payment option "${paymentOption}" is not offered for this product (${offered.join(', ')}).` }
    }
    if (paymentOption === schedule.frequency) {
      return { success: false, error: `invalid_args: the payment plan already uses the ${paymentOption} frequency.` }
    }

    // P0-2 audit: do the DB writes FIRST, then the irreversible provider
    // cancel LAST. If any DB write fails the whole apply tx rolls back with the
    // provider intent still live (consistent — the re-rate simply didn't
    // happen); the old order cancelled the intent before the writes, so a
    // rollback left the DB pointing at a cancelled intent.
    const provider = getPaymentProvider()
    const openAttempt = schedule.installments.flatMap((i) => i.payments).find((p) => p.status === 'PENDING')

    const rows = buildSchedule({ premiumAnnual: quote.premiumAnnual, frequency: paymentOption, startAt: new Date() })
    const newSchedule = await context.db.paymentSchedule.create({
      data: {
        quoteId: schedule.quoteId,
        customerId: schedule.customerId,
        frequency: paymentOption,
        totalInstallments: rows.length,
        currency: schedule.currency,
        installments: { create: rows },
      },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    })
    await context.db.paymentSchedule.update({
      where: { id: schedule.id },
      data: { status: 'SUPERSEDED', supersededById: newSchedule.id },
    })

    // capturable sessions never survive a re-rate — supersede the old attempt
    // in the DB, then cancel it at the provider (last, irreversible).
    if (openAttempt?.providerPaymentId) {
      await context.db.payment.updateMany({ where: { providerPaymentId: openAttempt.providerPaymentId, status: 'PENDING' }, data: { status: 'SUPERSEDED' } })
      await provider.cancelPaymentIntent(openAttempt.providerPaymentId)
    }

    const oldTotalMinor = schedule.installments.reduce((t, i) => t + i.amountMinor, 0)
    const newTotalMinor = newSchedule.installments.reduce((t, i) => t + i.amountMinor, 0)
    return {
      success: true,
      effects: ['re_rating'],
      data: {
        oldScheduleId: schedule.id,
        newScheduleId: newSchedule.id,
        oldFrequency: schedule.frequency,
        newFrequency: paymentOption,
        oldTotalMinor,
        newTotalMinor,
        firstInstallment: { amountMinor: newSchedule.installments[0].amountMinor, dueAt: newSchedule.installments[0].dueAt.toISOString() },
      },
      message: `Payment plan re-rated ${schedule.frequency} → ${paymentOption}: ${newSchedule.totalInstallments} installment(s), first ${(newSchedule.installments[0].amountMinor / 100).toFixed(2)} ${schedule.currency}. The quote itself is unchanged.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
