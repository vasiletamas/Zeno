/**
 * Transactional settlement inbox (D2.6, T8.D3 / contradiction #5).
 *
 * Provider events land here exactly once: the PaymentEvent row (unique on
 * provider+providerEventId) is the dedup key, written FIRST inside the same
 * transaction as every state change it causes — Payment CAS, Installment
 * PAID/FAILED, schedule advance, and THE POLICY, which is created in
 * PENDING_SUBMISSION with issuedAt stamped inside the FIRST successful
 * settlement transaction (paid ≠ submitted — the SUBMITTED write died with
 * post-payment.ts's flow). Duplicates replay (pre-checked: a P2002 inside
 * an interactive tx would abort it); unmatched events are recorded and
 * reported so callers can 200-and-ignore verified-but-irrelevant webhooks.
 *
 * Side effects (confirmation email + re-entry magic link) run AFTER the
 * transaction, best-effort, only on the first capture.
 */
import { prisma } from '@/lib/db'
import type { Prisma } from '@/lib/generated/prisma/client'
import { createWorkItem } from '@/lib/work-items/service'
import { getEmailProvider } from '@/lib/email'
import { issueChallenge } from '@/lib/customer/verification-service'
import { purchaseConfirmationEmail } from '@/lib/email/templates/purchase-confirmation'
import { trackPaymentCompleted } from '@/lib/analytics/events'
import { logError } from '@/lib/errors/logger'

export interface SettlementEvent {
  provider: 'STRIPE' | 'PAYU' | 'MOCK'
  eventId: string
  event: 'payment_succeeded' | 'payment_failed'
  providerPaymentId: string
  failureReason?: string
}

export interface SettlementResult {
  disposition: 'applied' | 'replay' | 'unmatched'
  firstCapture?: boolean
  paymentId?: string
}

type Db = typeof prisma | Prisma.TransactionClient

/**
 * D2.ADD-1 (G11a): payment-pipeline anomalies become ALERT_FLAG WorkItems —
 * exactly once per anomaly identity (an OPEN alert with the same anomalyKey
 * absorbs redeliveries, even under fresh provider event ids). Wired into
 * the inbox transaction for amount-mismatch and unmatched events; webhook
 * routes call it on signature failures (which never reach the inbox).
 */
export async function recordPaymentAnomaly(
  input: { anomaly: 'bad_signature' | 'amount_mismatch' | 'unmatched_payment'; ref: string; reason: string; refs?: Record<string, string> },
  db: Db = prisma,
): Promise<void> {
  const anomalyKey = `${input.anomaly}:${input.ref}`
  const existing = await db.workItem.findFirst({
    where: { kind: 'ALERT_FLAG', status: 'OPEN', payload: { path: ['anomalyKey'], equals: anomalyKey } },
    select: { id: true },
  })
  if (existing) return
  await createWorkItem({
    kind: 'ALERT_FLAG',
    reason: input.reason,
    refs: (input.refs ?? {}) as never,
    createdBy: 'payment-inbox',
    priority: 'HIGH',
    payload: { anomalyKey, anomaly: input.anomaly },
  }, db)
}

export async function settlePaymentEvent(e: SettlementEvent): Promise<SettlementResult> {
  const result = await prisma.$transaction(async (tx) => {
    // dedup PRE-CHECK — a P2002 create-catch would abort the interactive tx
    // (pinned lesson); a concurrent duplicate still aborts on the unique
    // index and the provider retries into a clean replay.
    const seen = await tx.paymentEvent.findUnique({
      where: { provider_providerEventId: { provider: e.provider, providerEventId: e.eventId } },
    })
    if (seen) return { disposition: 'replay' as const }
    await tx.paymentEvent.create({
      data: {
        provider: e.provider, providerEventId: e.eventId,
        providerPaymentId: e.providerPaymentId, kind: e.event,
        payload: e as unknown as Prisma.InputJsonValue,
      },
    })
    const payment = await tx.payment.findUnique({
      where: { providerPaymentId: e.providerPaymentId },
      include: { installment: { include: { schedule: { include: { installments: true, quote: true } } } } },
    })
    if (!payment) {
      // D2.ADD-1: a verified event naming a payment we do not know is an
      // anomaly worth an operator's eyes — once per provider payment id.
      await recordPaymentAnomaly({
        anomaly: 'unmatched_payment',
        ref: `${e.provider}:${e.providerPaymentId}`,
        reason: `unmatched_payment: verified ${e.provider} event ${e.eventId} names unknown providerPaymentId ${e.providerPaymentId}`,
        refs: { eventId: e.eventId },
      }, tx)
      return { disposition: 'unmatched' as const }
    }

    // D2.ADD-1: the captured amount must match the installment it settles —
    // drift is flagged (exactly once) but the settlement itself proceeds:
    // the money moved; the operator reconciles.
    if (payment.amountMinor !== payment.installment.amountMinor) {
      await recordPaymentAnomaly({
        anomaly: 'amount_mismatch',
        ref: payment.id,
        reason: `amount_mismatch: payment ${payment.id} captured ${payment.amountMinor} against installment ${payment.installment.id} of ${payment.installment.amountMinor}`,
        refs: { paymentId: payment.id, customerId: payment.customerId },
      }, tx)
    }

    if (e.event === 'payment_failed') {
      await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: e.failureReason ?? 'provider_failed' } })
      await tx.installment.updateMany({ where: { id: payment.installmentId, status: 'PENDING' }, data: { status: 'FAILED' } })
      return { disposition: 'applied' as const, firstCapture: false, paymentId: payment.id }
    }

    const cas = await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'COMPLETED', paidAt: new Date() } })
    if (cas.count === 0) return { disposition: 'replay' as const }
    await tx.installment.update({ where: { id: payment.installmentId }, data: { status: 'PAID', paidAt: new Date() } })
    const schedule = payment.installment.schedule
    const paidCount = schedule.installments.filter((i) => i.status === 'PAID' || i.id === payment.installmentId).length
    const isFirstCapture = paidCount === 1
    await tx.paymentSchedule.update({
      where: { id: schedule.id },
      data: { status: paidCount === schedule.totalInstallments ? 'COMPLETED' : 'ACTIVE' },
    })
    if (isFirstCapture) {
      // contradiction #5: the POLICY comes into existence at first capture —
      // PENDING_SUBMISSION (an operator submits it), issuedAt = now.
      await tx.policy.create({
        data: {
          quoteId: schedule.quoteId,
          customerId: schedule.customerId,
          productId: schedule.quote.productId,
          status: 'PENDING_SUBMISSION',
          premiumAnnual: schedule.quote.premiumAnnual,
          premiumMonthly: schedule.quote.premiumMonthly,
          paymentFrequency: schedule.frequency,
          currency: schedule.quote.currency,
          coverageSummary: schedule.quote.coverages as Prisma.InputJsonValue,
          issuedAt: new Date(),
        },
      })
    }
    return { disposition: 'applied' as const, firstCapture: isFirstCapture, paymentId: payment.id }
  })

  if (result.disposition === 'applied' && result.firstCapture && result.paymentId) {
    await runFirstCaptureSideEffects(result.paymentId).catch((error) => {
      logError({
        layer: 'tool', category: 'settlement',
        message: `first-capture side effects failed for payment ${result.paymentId} (settlement stands)`,
        context: { paymentId: result.paymentId }, error,
      })
    })
  }
  return result
}

/**
 * Post-transaction, best-effort (lifted from the retired post-payment flow):
 * customer goes non-anonymous, a 7-day re-entry challenge link rides the
 * purchase-confirmation email (its standalone send suppressed).
 */
async function runFirstCaptureSideEffects(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      installment: {
        include: {
          schedule: {
            include: {
              quote: { include: { application: { include: { tier: true, level: true } }, policy: true } },
            },
          },
        },
      },
      customer: true,
    },
  })
  const { customer } = payment
  const quote = payment.installment.schedule.quote
  const policy = quote.policy

  trackPaymentCompleted(customer.id, payment.amountMinor / 100)
  await prisma.customer.update({ where: { id: customer.id }, data: { isAnonymous: false } })

  if (!customer.email) return
  const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
  const conversationId = quote.application?.originConversationId ?? null
  const { linkToken } = await issueChallenge(
    customer.id, 'email', customer.email, conversationId,
    prisma,
    { send: async () => ({ messageId: 'embedded-in-confirmation-email' }) },
    7 * 24 * 60 * 60 * 1000,
  )
  const dashboardUrl = `${appUrl}/api/auth/verify?token=${linkToken}`

  const customerLanguage = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'
  const tierNameJson = quote.application?.tier?.name as Record<string, string> | null
  const levelNameJson = quote.application?.level?.name as Record<string, string> | null
  const currency = policy?.currency ?? quote.currency
  // coverageSummary carries the quote's coverages OBJECT
  // ({ baseCoverages, addonCoverages, ... }) — flatten for the email
  const summary = (policy?.coverageSummary ?? quote.coverages ?? {}) as {
    baseCoverages?: Array<{ name: string | Record<string, string>; amount: number; currency: string }>
    addonCoverages?: Array<{ name: string | Record<string, string>; amount: number; currency: string }>
  }
  const allCoverages = [...(summary.baseCoverages ?? []), ...(summary.addonCoverages ?? [])]
  const { subject, html } = purchaseConfirmationEmail({
    customerName: customer.name ?? 'Client',
    tierName: tierNameJson?.[customerLanguage] ?? tierNameJson?.ro ?? 'Standard',
    levelName: levelNameJson?.[customerLanguage] ?? levelNameJson?.ro ?? 'Nivel I',
    includesAddon: quote.application?.includesAddon ?? false,
    premiumMonthly: policy?.premiumMonthly ?? quote.premiumMonthly,
    currency,
    coverages: allCoverages.map((cov) => ({
      name: typeof cov.name === 'string' ? cov.name : (cov.name?.[customerLanguage] ?? cov.name?.ro ?? ''),
      amount: cov.amount,
      currency: cov.currency ?? currency,
    })),
    dashboardUrl,
    language: customerLanguage,
  })
  await getEmailProvider().send({ to: customer.email, subject, html })
}
