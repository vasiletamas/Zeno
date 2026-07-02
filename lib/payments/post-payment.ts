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
import { generateDntReport } from '@/lib/compliance/dnt-report'
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
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      policy: {
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
          product: true,
        },
      },
      customer: true,
    },
  })

  const { policy, customer } = payment

  trackPaymentCompleted(customer.id, payment.amount)

  // ─── Step 3: Update Policy → SUBMITTED ─────────────────────
  await prisma.policy.update({
    where: { id: policy.id },
    data: { status: 'SUBMITTED' },
  })

  // ─── Step 3b: Generate DNT suitability report PDF ─────────
  try {
    await generateDntReport(policy.id)
    console.log(`[PostPayment] DNT report generated for policy ${policy.id}`)
  } catch (error) {
    // PDF failure must not block the payment flow
    logError({
      layer: 'tool',
      category: 'post_payment',
      message: `DNT report generation failed for policy ${policy.id}`,
      context: { policyId: policy.id, paymentId },
      error,
    })
  }

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
    const conversationId = payment.policy.quote?.application?.conversationId ?? null
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
      const quote = policy.quote
      const application = quote?.application
      const tier = application?.tier
      const level = application?.level

      const tierNameJson = tier?.name as Record<string, string> | null
      const levelNameJson = level?.name as Record<string, string> | null
      const customerLanguage = (customer.language === 'en' ? 'en' : 'ro') as 'ro' | 'en'

      const tierName = tierNameJson?.[customerLanguage] ?? tierNameJson?.ro ?? 'Standard'
      const levelName = levelNameJson?.[customerLanguage] ?? levelNameJson?.ro ?? 'Nivel I'

      // Parse coverages from policy coverageSummary
      const coverageSummary = policy.coverageSummary as Array<{
        name: string | Record<string, string>
        amount: number
        currency: string
      }> | null

      const coverages = (coverageSummary ?? []).map((cov) => ({
        name: typeof cov.name === 'string' ? cov.name : (cov.name[customerLanguage] ?? cov.name.ro ?? ''),
        amount: cov.amount,
        currency: cov.currency ?? policy.currency,
      }))

      const { subject, html } = purchaseConfirmationEmail({
        customerName: customer.name ?? 'Client',
        tierName,
        levelName,
        includesAddon: application?.includesAddon ?? false,
        premiumMonthly: policy.premiumMonthly,
        currency: policy.currency,
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
      `policy=${policy.id} → SUBMITTED, ` +
      `customer=${customer.id} → non-anonymous, ` +
      `emailSent=${emailSent}`,
  )

  return { emailSent }
}
