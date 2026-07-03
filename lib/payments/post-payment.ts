/**
 * Post-Payment Flow
 *
 * Idempotent post-payment processing with atomic compare-and-swap.
 * Safe to call from both confirm API and webhooks concurrently.
 *
 * Steps:
 * 1. Atomic CAS: PENDING → COMPLETED (only first caller wins)
 * 2. Load related records (Policy, Customer, Quote)
 * 3. Update Policy status → SUBMITTED
 * 4. Generate magic link for customer dashboard access
 * 5. Send confirmation email (catch errors, never throw)
 */

import { prisma } from '@/lib/db'
import { getEmailProvider } from '@/lib/email'
import { issueChallenge } from '@/lib/customer/verification-service'
import { purchaseConfirmationEmail } from '@/lib/email/templates/purchase-confirmation'
import { trackPaymentCompleted } from '@/lib/analytics/events'
import { logError } from '@/lib/errors/logger'

export async function runPostPaymentFlow(
  paymentId: string,
): Promise<{ emailSent: boolean }> {
  // ─── Step 1: Atomic compare-and-swap ───────────────────────
  // Only the first caller succeeds. Second caller sees count=0.
  const updated = await prisma.payment.updateMany({
    where: { id: paymentId, status: 'PENDING' },
    data: { status: 'COMPLETED', paidAt: new Date() },
  })

  if (updated.count === 0) {
    // Already processed or payment not found
    return { emailSent: false }
  }

  // ─── Step 2: Load related records ──────────────────────────
  // D2.1 re-anchor: a Payment settles an INSTALLMENT; the quote (and its
  // policy, while accept_quote still creates one — D2.6 flips that) is
  // reached through the schedule.
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      installment: {
        include: {
          schedule: {
            include: {
              quote: {
                include: {
                  application: { include: { tier: true, level: true } },
                  product: true,
                  policy: true,
                },
              },
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

  // ─── Step 3: Update Policy → SUBMITTED ─────────────────────
  // (D2.6 removes this write: paid ≠ submitted — contradiction #5)
  if (policy) {
    await prisma.policy.update({
      where: { id: policy.id },
      data: { status: 'SUBMITTED' },
    })
  }

  // Step 3b (retired at D1, M7/IDD timing): the suitability report is
  // generated AT QUOTE ISSUANCE inside generate_quote's transaction — the
  // post-policy generateDntReport call died with the flip (one report
  // path, never zero or two).

  // ─── Step 4: Mint the re-entry link (B3.6: challenge primitive) ─
  // The link rides the purchase-confirmation email below, so the
  // challenge's own send is suppressed. It carries the paying conversation
  // id — /api/auth/verify returns the customer to that conversation with a
  // bound session (fixes the old dead /dashboard?token=... URL).
  await prisma.customer.update({
    where: { id: customer.id },
    data: { isAnonymous: false },
  })

  const appUrl = process.env.APP_URL ?? 'http://localhost:3001'
  let dashboardUrl = `${appUrl}/dashboard`
  if (customer.email) {
    const conversationId = quote.application?.originConversationId ?? null
    const { linkToken } = await issueChallenge(
      customer.id, 'email', customer.email, conversationId,
      prisma,
      { send: async () => ({ messageId: 'embedded-in-confirmation-email' }) },
      7 * 24 * 60 * 60 * 1000,
    )
    dashboardUrl = `${appUrl}/api/auth/verify?token=${linkToken}`
  }

  // ─── Step 5: Send confirmation email ───────────────────────
  let emailSent = false

  if (customer.email) {
    try {
      const emailProvider = getEmailProvider()

      // Extract tier/level names for email
      const application = quote.application
      const tier = application?.tier
      const level = application?.level

      const tierNameJson = tier?.name as Record<string, string> | null
      const levelNameJson = level?.name as Record<string, string> | null
      const customerLanguage = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'

      const tierName = tierNameJson?.[customerLanguage] ?? tierNameJson?.ro ?? 'Standard'
      const levelName = levelNameJson?.[customerLanguage] ?? levelNameJson?.ro ?? 'Nivel I'

      // Parse coverages from policy coverageSummary (quote currency when the
      // policy has not been created yet — D2.6 flips creation to settlement)
      const currency = policy?.currency ?? quote.currency
      const coverageSummary = (policy?.coverageSummary ?? null) as Array<{
        name: string | Record<string, string>
        amount: number
        currency: string
      }> | null

      const coverages = (coverageSummary ?? []).map((cov) => ({
        name: typeof cov.name === 'string' ? cov.name : (cov.name[customerLanguage] ?? cov.name.ro ?? ''),
        amount: cov.amount,
        currency: cov.currency ?? currency,
      }))

      const { subject, html } = purchaseConfirmationEmail({
        customerName: customer.name ?? 'Client',
        tierName,
        levelName,
        includesAddon: application?.includesAddon ?? false,
        premiumMonthly: policy?.premiumMonthly ?? quote.premiumMonthly,
        currency,
        coverages,
        dashboardUrl,
        language: customerLanguage,
      })

      await emailProvider.send({
        to: customer.email,
        subject,
        html,
      })

      emailSent = true
      console.log(`[PostPayment] Email sent to ${customer.email} for payment ${paymentId}`)
    } catch (error) {
      // Email failure: log and continue. Payment already succeeded.
      logError({
        layer: 'tool',
        category: 'post_payment',
        message: `Failed to send confirmation email for payment ${paymentId}`,
        context: { paymentId, customerId: customer.id, email: customer.email },
        error,
      })
    }
  } else {
    console.log(`[PostPayment] No email on file for customer ${customer.id}, skipping email`)
  }

  console.log(
    `[PostPayment] Completed for payment ${paymentId}: ` +
      `policy=${policy ? `${policy.id} → SUBMITTED` : 'none'}, ` +
      `customer=${customer.id} → non-anonymous, ` +
      `emailSent=${emailSent}`,
  )

  return { emailSent }
}
