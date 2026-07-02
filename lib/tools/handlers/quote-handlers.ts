/**
 * Quote Handlers
 *
 * generate_quote, get_quote_details, accept_quote, modify_quote
 */

import { calculateQuote } from '@/lib/engines/quote-engine'
import type { QuoteInput } from '@/lib/engines/quote-engine'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { verifyConsents } from '@/lib/compliance/consent-check'
import type { ToolHandler } from '@/lib/tools/types'
import { trackQuoteGenerated, trackQuoteAccepted } from '@/lib/analytics/events'

// ─────────────────────────────────────────────
// generate_quote
// ─────────────────────────────────────────────

export const generateQuote: ToolHandler = async (_args, context) => {
  try {
    // Verify GDPR consents before generating quote
    const consents = await verifyConsents(context.conversationId)
    if (!consents.valid) {
      return {
        success: false,
        error: `GDPR consents required: missing ${consents.missing.join(', ')}`,
      }
    }

    // Load application (must be COMPLETED)
    const application = await context.db.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application) {
      return { success: false, error: 'No application found.' }
    }
    if (application.status !== 'COMPLETED') {
      return {
        success: false,
        error: `Application is not complete (status: ${application.status}). Please finish the questionnaire first.`,
      }
    }

    // Need tierId + levelId
    if (!application.tierId || !application.levelId) {
      return {
        success: false,
        error: 'Application is missing package or premium level selection.',
      }
    }

    // Load PricingLevel with PricingTier
    const pricingLevel = await context.db.pricingLevel.findUnique({
      where: { id: application.levelId },
      include: { tier: true },
    })
    if (!pricingLevel) {
      return { success: false, error: 'Pricing level not found.' }
    }

    // Calculate customer age from Customer.dateOfBirth
    let customerAge = 30 // fallback
    const customer = await context.db.customer.findUnique({
      where: { id: application.customerId },
    })
    if (customer?.dateOfBirth) {
      const today = new Date()
      const dob = customer.dateOfBirth
      customerAge = today.getFullYear() - dob.getFullYear()
      const monthDiff = today.getMonth() - dob.getMonth()
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        customerAge--
      }
    }

    // Load base CoverageAmounts for this pricing level
    const baseCoverageAmounts = await context.db.coverageAmount.findMany({
      where: { pricingLevelId: pricingLevel.id },
      include: { coverageType: true },
    })

    // Filter age-based coverages
    const baseCoverages = baseCoverageAmounts
      .filter(ca => {
        if (ca.isAgeBased) {
          return (
            (ca.minAge === null || customerAge >= ca.minAge) &&
            (ca.maxAge === null || customerAge <= ca.maxAge)
          )
        }
        return true
      })
      .map(ca => ({
        code: ca.coverageType.code,
        name: ca.coverageType.name as { en: string; ro: string },
        amount: ca.amount,
        currency: ca.currency,
      }))

    // Load addon pricing if applicable
    let addonPricingRule: { premiumAnnual: number } | null = null
    let addonCoverages: {
      code: string
      name: { en: string; ro: string }
      amount: number
      currency: string
    }[] = []

    if (application.includesAddon) {
      // Find addon for this product
      const addon = await context.db.addon.findFirst({
        where: { productId: application.productId, isActive: true },
        include: {
          pricingRules: true,
          coverageAmounts: { include: { coverageType: true } },
        },
      })

      if (addon) {
        // Find pricing rule matching customer age
        const matchingRule = addon.pricingRules.find(
          r => customerAge >= r.minAge && customerAge <= r.maxAge,
        )
        if (matchingRule) {
          addonPricingRule = { premiumAnnual: matchingRule.premiumAnnual }
        }

        // Addon coverages
        addonCoverages = addon.coverageAmounts.map(ca => ({
          code: ca.coverageType.code,
          name: ca.coverageType.name as { en: string; ro: string },
          amount: ca.amount,
          currency: ca.currency,
        }))
      }
    }

    // Detect payment frequency from application answers
    let paymentFrequency: 'annual' | 'semi_annual' | 'quarterly' = 'annual'
    const paymentQuestion = await context.db.question.findFirst({
      where: { code: 'PAYMENT_FREQUENCY' },
    })
    if (paymentQuestion) {
      const paymentAnswer = await context.db.answer.findUnique({
        where: {
          questionId_conversationId: {
            questionId: paymentQuestion.id,
            conversationId: context.conversationId,
          },
        },
      })
      if (paymentAnswer) {
        const val = paymentAnswer.value as string
        if (val === 'semi_annual' || val === 'quarterly') {
          paymentFrequency = val
        }
      }
    }

    // Load product for quoteValidityDays
    const product = await context.db.product.findUnique({
      where: { id: application.productId },
    })

    // Build QuoteInput
    const quoteInput: QuoteInput = {
      tierCode: pricingLevel.tier.code,
      levelCode: pricingLevel.code,
      customerAge,
      includesAddon: application.includesAddon,
      paymentFrequency,
      pricingLevel: {
        premiumAnnual: pricingLevel.premiumAnnual,
        name: pricingLevel.name as { en: string; ro: string },
      },
      pricingTier: {
        name: pricingLevel.tier.name as { en: string; ro: string },
      },
      baseCoverages,
      addonPricingRule,
      addonCoverages,
      quoteValidityDays: product?.quoteValidityDays ?? 30,
    }

    const result = calculateQuote(quoteInput)

    // Create Quote record
    const quote = await context.db.quote.create({
      data: {
        applicationId: application.id,
        productId: application.productId,
        customerId: application.customerId,
        premiumAnnual: result.premiumAnnual,
        premiumMonthly: result.premiumMonthly,
        premiumSemiAnnual: result.premiumSemiAnnual,
        premiumQuarterly: result.premiumQuarterly,
        paymentFrequency,
        currency: 'RON',
        coverages: JSON.parse(JSON.stringify({
          baseCoverages: result.baseCoverages,
          addonCoverages: result.addonCoverages,
          basePremiumAnnual: result.basePremiumAnnual,
          addonPremiumAnnual: result.addonPremiumAnnual,
          pricingTierLabel: result.pricingTierLabel,
          pricingLevelLabel: result.pricingLevelLabel,
        })),
        addonsSelected: application.includesAddon
          ? JSON.parse(JSON.stringify({ included: true, addonPremiumAnnual: result.addonPremiumAnnual }))
          : undefined,
        status: 'DRAFT',
        validUntil: result.validUntil,
      },
    })

    trackQuoteGenerated(application.customerId, result.premiumAnnual)

    return {
      success: true,
      data: {
        quoteGenerated: true,
        quoteId: quote.id,
        premiumAnnual: result.premiumAnnual,
        premiumMonthly: result.premiumMonthly,
        premiumSemiAnnual: result.premiumSemiAnnual,
        premiumQuarterly: result.premiumQuarterly,
        paymentFrequency,
        basePremiumAnnual: result.basePremiumAnnual,
        addonPremiumAnnual: result.addonPremiumAnnual,
        baseCoverages: result.baseCoverages as unknown as Record<string, unknown>[],
        addonCoverages: result.addonCoverages as unknown as Record<string, unknown>[],
        pricingTierLabel: result.pricingTierLabel as unknown as Record<string, unknown>,
        pricingLevelLabel: result.pricingLevelLabel as unknown as Record<string, unknown>,
        validUntil: result.validUntil.toISOString(),
      },
      message: `Quote generated: ${result.premiumAnnual} RON/year (${result.premiumMonthly} RON/month). Valid until ${result.validUntil.toISOString().split('T')[0]}.`,
      uiAction: {
        type: 'show_quote',
        payload: {
          quoteId: quote.id,
          tierName: result.pricingTierLabel,
          levelName: result.pricingLevelLabel,
          includesAddon: application.includesAddon,
          premiumAnnual: result.premiumAnnual,
          premiumMonthly: result.premiumMonthly,
          baseCoverages: result.baseCoverages,
          addonCoverages: result.addonCoverages,
          validUntil: result.validUntil.toISOString(),
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// get_quote_details
// ─────────────────────────────────────────────

export const getQuoteDetails: ToolHandler = async (args, context) => {
  try {
    const quoteId = args.quoteId as string | undefined

    let quote

    if (quoteId) {
      quote = await context.db.quote.findUnique({
        where: { id: quoteId },
      })
    } else {
      // Find quote via application for this conversation
      const application = await context.db.application.findUnique({
        where: { conversationId: context.conversationId },
      })
      if (application) {
        quote = await context.db.quote.findUnique({
          where: { applicationId: application.id },
        })
      }
    }

    if (!quote) {
      return { success: false, error: 'No quote found.' }
    }

    const coverages = quote.coverages as Record<string, unknown>
    const addonsSelected = quote.addonsSelected as Record<string, unknown> | null

    return {
      success: true,
      data: {
        quoteId: quote.id,
        premiumAnnual: quote.premiumAnnual,
        premiumMonthly: quote.premiumMonthly,
        premiumSemiAnnual: quote.premiumSemiAnnual,
        premiumQuarterly: quote.premiumQuarterly,
        paymentFrequency: quote.paymentFrequency,
        currency: quote.currency,
        status: quote.status,
        validUntil: quote.validUntil.toISOString(),
        coverages,
        addonsSelected,
      },
      message: `Quote details: ${quote.premiumAnnual} RON/year. Status: ${quote.status}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// accept_quote
// ─────────────────────────────────────────────

export const acceptQuote: ToolHandler = async (args, context) => {
  const confirmAcceptance = args.confirmAcceptance as boolean

  try {
    if (!confirmAcceptance) {
      return { success: false, error: 'Confirmation is required to accept the quote.' }
    }

    // Find quote via application for this conversation
    const application = await context.db.application.findUnique({
      where: { conversationId: context.conversationId },
    })
    if (!application) {
      return { success: false, error: 'No application found.' }
    }

    const quote = await context.db.quote.findUnique({
      where: { applicationId: application.id },
    })
    if (!quote) {
      return { success: false, error: 'No quote found.' }
    }

    if (quote.status !== 'DRAFT') {
      return { success: false, error: `Quote is not in DRAFT status (current: ${quote.status}).` }
    }

    // Check expiry
    if (new Date() > quote.validUntil) {
      await context.db.quote.update({
        where: { id: quote.id },
        data: { status: 'EXPIRED' },
      })
      return { success: false, error: 'Quote has expired. Please generate a new quote.' }
    }

    // Update Quote status -> ACCEPTED
    await context.db.quote.update({
      where: { id: quote.id },
      data: { status: 'ACCEPTED' },
    })

    // Create Policy (PENDING_SUBMISSION)
    const policy = await context.db.policy.create({
      data: {
        quoteId: quote.id,
        customerId: quote.customerId,
        productId: quote.productId,
        status: 'PENDING_SUBMISSION',
        premiumAnnual: quote.premiumAnnual,
        premiumMonthly: quote.premiumMonthly,
        currency: quote.currency,
        coverageSummary: JSON.parse(JSON.stringify(quote.coverages)),
        issuedAt: new Date(),
      },
    })

    trackQuoteAccepted(quote.customerId, quote.premiumAnnual)

    // Update Conversation status -> COMPLETED
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    })

    // Load tier/level names for uiAction payload
    const appWithPricing = await context.db.application.findUnique({
      where: { id: application.id },
      include: {
        tier: { select: { name: true } },
        level: { select: { name: true } },
      },
    })

    const tierName = (appWithPricing?.tier?.name ?? { en: 'Standard', ro: 'Standard' }) as { en: string; ro: string }
    const levelName = (appWithPricing?.level?.name ?? { en: 'Level', ro: 'Nivel' }) as { en: string; ro: string }
    const includesAddon = appWithPricing?.includesAddon ?? false

    // Calculate total coverage from coverages data
    const coveragesData = quote.coverages as Record<string, unknown>
    const baseCovs = (coveragesData?.baseCoverages ?? []) as Array<{ amount: number; currency: string }>
    const addonCovs = (coveragesData?.addonCoverages ?? []) as Array<{ amount: number; currency: string }>
    const allCovs = [...baseCovs, ...addonCovs]

    // Group by currency and sum
    const totals = new Map<string, number>()
    for (const c of allCovs) {
      totals.set(c.currency, (totals.get(c.currency) ?? 0) + c.amount)
    }
    const totalParts = Array.from(totals.entries()).map(([cur, amt]) => {
      const formatted = amt >= 1_000_000
        ? `${(amt / 1_000_000).toLocaleString('ro-RO')} M ${cur}`
        : `${amt.toLocaleString('ro-RO')} ${cur}`
      return formatted
    })
    const totalCoverage = totalParts.join(' + ') || `${quote.premiumAnnual} RON`

    return {
      success: true,
      data: {
        policyCreated: true,
        policyId: policy.id,
        policyStatus: 'PENDING_SUBMISSION',
        quoteId: quote.id,
        premiumAnnual: quote.premiumAnnual,
        premiumMonthly: quote.premiumMonthly,
      },
      message:
        'Quote accepted! Your policy has been created and is pending submission to Allianz. An operator will process it shortly.',
      uiAction: {
        type: 'show_policy_issued',
        payload: {
          policyId: policy.id,
          tierName,
          levelName,
          includesAddon,
          premiumMonthly: quote.premiumMonthly,
          totalCoverage,
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// modify_quote
// ─────────────────────────────────────────────

export const modifyQuote: ToolHandler = async (_args, context) => {
  try {
    // Find application and current quote
    const application = await context.db.application.findUnique({
      where: { conversationId: context.conversationId },
    })
    if (!application) {
      return { success: false, error: 'No application found.' }
    }

    const quote = await context.db.quote.findUnique({
      where: { applicationId: application.id },
    })
    if (!quote) {
      return { success: false, error: 'No quote found to modify.' }
    }

    // Expire current quote
    await context.db.quote.update({
      where: { id: quote.id },
      data: { status: 'EXPIRED' },
    })

    // Reset Application for re-selection
    await context.db.application.update({
      where: { id: application.id },
      data: {
        tierId: null,
        levelId: null,
        currentQuestionIndex: 0,
        status: 'OPEN',
        completedAt: null,
      },
    })

    // Delete the selection answers (PACKAGE_CHOICE, PREMIUM_LEVEL, BD_ADDON_INTEREST, PAYMENT_FREQUENCY)
    // so the customer can re-answer them
    const specialCodes = ['PACKAGE_CHOICE', 'PREMIUM_LEVEL', 'BD_ADDON_INTEREST', 'PAYMENT_FREQUENCY']
    const specialQuestions = await context.db.question.findMany({
      where: { code: { in: specialCodes } },
    })
    if (specialQuestions.length > 0) {
      await context.db.answer.deleteMany({
        where: {
          conversationId: context.conversationId,
          questionId: { in: specialQuestions.map(q => q.id) },
        },
      })
    }

    // Get next question
    const nextResult = await getNextQuestion(['application'], { kind: 'conversation', conversationId: context.conversationId })

    const lang = context.language ?? 'ro'
    let nextQuestionData: Record<string, unknown> | null = null
    if (nextResult) {
      const nq = nextResult.question
      const nqText = nq.text as { en: string; ro: string }
      nextQuestionData = {
        id: nq.id,
        code: nq.code,
        text: nqText[lang],
        type: nq.type,
        options: nq.options,
      }
    }

    return {
      success: true,
      data: {
        modificationStarted: true,
        oldQuoteId: quote.id,
        applicationId: application.id,
        nextQuestion: nextQuestionData,
      },
      message:
        'Quote expired. Application reopened for package/level re-selection. Please answer the questions to generate an updated quote.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
