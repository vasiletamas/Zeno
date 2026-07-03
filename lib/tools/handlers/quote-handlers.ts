/**
 * Quote Handlers
 *
 * generate_quote, get_quote_info, accept_quote, cancel_quote, modify_quote
 */

import { calculateQuote } from '@/lib/engines/quote-engine'
import type { QuoteInput } from '@/lib/engines/quote-engine'
import { decideQuoteIssue } from '@/lib/engines/quote-decision'
import { canQuoteTransition, effectiveQuoteStatus, type QuoteStatusV3 } from '@/lib/engines/quote-lifecycle'
import { evaluateEligibility } from '@/lib/engines/eligibility'
import { deriveSuitability } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { getAge } from '@/lib/customer/profile-service'
import { createReferralWorkItem } from '@/lib/work-items/referral'
import { generateSuitabilityReport } from '@/lib/compliance/suitability-report'
import { loadActiveApplication } from './application-handlers'
import type { ToolHandler } from '@/lib/tools/types'
import { trackQuoteGenerated, trackQuoteAccepted } from '@/lib/analytics/events'

// ─────────────────────────────────────────────
// generate_quote
// ─────────────────────────────────────────────

export const generateQuote: ToolHandler = async (_args, context) => {
  try {
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'no_open_application: no application found.' }
    }
    // T7.D1 belt (legality is the wall): a Quote row in ANY state — or a
    // set frozenAt — freezes the application; recovery is cancel_quote + a
    // new application, never a re-issue.
    const quoteCount = await context.db.quote.count({ where: { applicationId: application.id } })
    if (quoteCount > 0 || application.frozenAt !== null) {
      return { success: false, error: 'application_frozen: the application froze when its quote was issued — cancel the quote and open a new application to change anything.' }
    }
    if (application.status !== 'OPEN') {
      return { success: false, error: `illegal_status_transition: a ${application.status} application is not quotable.` }
    }
    if (!application.tierId || !application.levelId) {
      return { success: false, error: 'selection_incomplete: choose the package and level first (select_coverage).' }
    }

    // ── the typed decision (D1.3): identity → compliance → eligibility →
    // suitability → referral — every input engine-derived, nothing guessed
    const snapshot = await loadDomainSnapshot(context.conversationId, context.db)
    const age = await getAge(application.customerId, new Date(), context.db as Parameters<typeof getAge>[2])
    const eligibilityRules = snapshot.product?.eligibilityRules ?? null
    const eligFacts = {
      ...snapshot.eligibilityFacts,
      ...Object.fromEntries(Object.entries(snapshot.answers).map(([c, v]) => [`answer:${c}`, v])),
    }
    const productElig = eligibilityRules ? evaluateEligibility(eligibilityRules, eligFacts, 'product') : { verdict: 'eligible' as const, failedRules: [], missingFacts: [] }
    const addonElig = eligibilityRules && application.includesAddon ? evaluateEligibility(eligibilityRules, eligFacts, 'addon') : null
    const mergedElig = {
      verdict: (productElig.verdict === 'ineligible' || addonElig?.verdict === 'ineligible')
        ? 'ineligible' as const
        : (productElig.verdict === 'unknown' || addonElig?.verdict === 'unknown') ? 'unknown' as const : 'eligible' as const,
      failedRules: [...productElig.failedRules, ...(addonElig?.failedRules ?? [])].map((f) => ({ rule: f.rule.id, reason: f.reason })),
      missingFacts: [...new Set([...productElig.missingFacts, ...(addonElig?.missingFacts ?? [])])],
    }
    const suitabilityRules = snapshot.product?.suitabilityRules ?? null
    const suitability = deriveSuitability(snapshot) ?? { verdict: 'suitable' as const, mismatches: [] }
    const flags = (application.flagsForReview as Array<{ questionCode?: string; reason?: string; action?: string }> | null) ?? []
    const decision = decideQuoteIssue({
      eligibility: mergedElig,
      suitability: { verdict: suitability.verdict, mismatches: suitability.mismatches.map((m) => ({ rule: m.rule.id, reason: m.reason })) },
      suitabilityWarningAcked: suitabilityRules !== null && snapshot.suitabilityAcks.some((a) => a.ruleSetVersion === suitabilityRules.version),
      suitabilityPolicy: suitabilityRules?.mode ?? 'warn_and_allow',
      consents: { gdprProcessing: snapshot.consents.gdprProcessing },
      dnt: { validForProductType: snapshot.dnt.valid && (snapshot.product ? snapshot.dnt.coversProductTypes.includes(snapshot.product.insuranceType) : false) },
      identity: { hasDobOrCnp: age !== null },
      escalationFlags: flags.filter((f) => f.action === 'escalate').map((f) => f.questionCode ?? f.reason ?? 'flag'), // erratum 9 mapping
    })
    const decided = JSON.parse(JSON.stringify({ ...decision, decidedAt: new Date().toISOString() }))

    if (decision.outcome === 'requires_identity') {
      // T7.D4: the decision is an audit fact even when it demands data
      await context.db.application.update({ where: { id: application.id }, data: { quoteDecision: decided } })
      return { success: false, error: 'requires_identity: the quote needs identity facts first.', data: { needs: decision.needs } }
    }
    if (decision.outcome === 'rejected') {
      await context.db.application.update({ where: { id: application.id }, data: { quoteDecision: decided } })
      return { success: false, error: `${decision.reason}: the quote decision rejected the application.` }
    }
    if (decision.outcome === 'referred') {
      // REFERRED + WorkItem in this same gateway transaction (E2 contract)
      await context.db.application.update({ where: { id: application.id }, data: { status: 'REFERRED', quoteDecision: decided } })
      await createReferralWorkItem({
        applicationId: application.id,
        customerId: application.customerId,
        conversationId: context.conversationId,
        reason: `manual_underwriting: ${flags.filter((f) => f.action === 'escalate').map((f) => f.reason ?? f.questionCode).join('; ') || 'escalation flags present'}`,
      }, context.db as Parameters<typeof createReferralWorkItem>[1])
      return {
        success: true,
        referred: { reason: 'manual_underwriting' },
        effects: ['eligibility_recheck'],
        data: { referred: true, applicationId: application.id },
        message: 'The application was referred for manual underwriting — an operator will review it. The customer will be notified of the outcome.',
      }
    }

    // ── issued: price with the DERIVED age (the 30-fallback is dead — the
    // decision above guarantees age is known), create the ISSUED quote and
    // FREEZE the application in this same transaction (T7.D1)
    const customerAge = age! // decision guarantees non-null
    const pricingLevel = await context.db.pricingLevel.findUnique({
      where: { id: application.levelId },
      include: { tier: true },
    })
    if (!pricingLevel) {
      return { success: false, error: 'Pricing level not found.' }
    }
    const baseCoverageAmounts = await context.db.coverageAmount.findMany({
      where: { pricingLevelId: pricingLevel.id },
      include: { coverageType: true },
    })
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

    let addonPricingRule: { premiumAnnual: number } | null = null
    let addonCoverages: { code: string; name: { en: string; ro: string }; amount: number; currency: string }[] = []
    if (application.includesAddon) {
      const addon = await context.db.addon.findFirst({
        where: { productId: application.productId, isActive: true },
        include: { pricingRules: true, coverageAmounts: { include: { coverageType: true } } },
      })
      if (addon) {
        const matchingRule = addon.pricingRules.find(r => customerAge >= r.minAge && customerAge <= r.maxAge)
        if (matchingRule) addonPricingRule = { premiumAnnual: matchingRule.premiumAnnual }
        addonCoverages = addon.coverageAmounts.map(ca => ({
          code: ca.coverageType.code,
          name: ca.coverageType.name as { en: string; ro: string },
          amount: ca.amount,
          currency: ca.currency,
        }))
      }
    }

    const product = await context.db.product.findUnique({ where: { id: application.productId } })
    const quoteInput: QuoteInput = {
      tierCode: pricingLevel.tier.code,
      levelCode: pricingLevel.code,
      customerAge,
      includesAddon: application.includesAddon,
      paymentFrequency: 'annual', // display default; the CONTRACT frequency is elected at accept (T7.D3)
      pricingLevel: { premiumAnnual: pricingLevel.premiumAnnual, name: pricingLevel.name as { en: string; ro: string } },
      pricingTier: { name: pricingLevel.tier.name as { en: string; ro: string } },
      baseCoverages,
      addonPricingRule,
      addonCoverages,
      quoteValidityDays: product?.quoteValidityDays ?? 30,
    }
    const result = calculateQuote(quoteInput)

    const quote = await context.db.quote.create({
      data: {
        applicationId: application.id,
        productId: application.productId,
        customerId: application.customerId,
        premiumAnnual: result.premiumAnnual,
        premiumMonthly: result.premiumMonthly,
        premiumSemiAnnual: result.premiumSemiAnnual,
        premiumQuarterly: result.premiumQuarterly,
        paymentFrequency: null, // elected at accept_quote, never at issue (T7.D3)
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
        status: 'ISSUED' as const,
        validUntil: result.validUntil,
      },
    })
    await context.db.application.update({
      where: { id: application.id },
      data: { status: 'COMPLETED', completedAt: new Date(), frozenAt: new Date(), quoteDecision: decided },
    })

    // M7/IDD timing (C3.6 flip): the suitability report registers AT
    // issuance, inside this transaction; the post-payment path died with it.
    try {
      await generateSuitabilityReport(quote.id, context.db as Parameters<typeof generateSuitabilityReport>[1])
    } catch (e) {
      console.error('[generate_quote] suitability report generation failed (quote stands):', e)
    }

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
        basePremiumAnnual: result.basePremiumAnnual,
        addonPremiumAnnual: result.addonPremiumAnnual,
        baseCoverages: result.baseCoverages as unknown as Record<string, unknown>[],
        addonCoverages: result.addonCoverages as unknown as Record<string, unknown>[],
        pricingTierLabel: result.pricingTierLabel as unknown as Record<string, unknown>,
        pricingLevelLabel: result.pricingLevelLabel as unknown as Record<string, unknown>,
        validUntil: result.validUntil.toISOString(),
        applicationFrozen: true,
      },
      message: `Quote issued: ${result.premiumAnnual} RON/year (${result.premiumMonthly} RON/month), valid until ${result.validUntil.toISOString().split('T')[0]}. The application is now frozen — changes require cancelling the quote and re-applying.`,
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
// get_quote_info (D1.6 — get_quote_details renamed)
// ─────────────────────────────────────────────

export const getQuoteInfo: ToolHandler = async (args, context) => {
  try {
    const quoteId = args.quoteId as string | undefined

    let quote

    if (quoteId) {
      quote = await context.db.quote.findUnique({
        where: { id: quoteId },
      })
    } else {
      // Find quote via the conversation's active application (B4)
      const application = await loadActiveApplication(context)
      if (application) {
        quote = await context.db.quote.findUnique({
          where: { applicationId: application.id },
        })
      }
    }

    if (!quote) {
      return { success: false, error: 'No quote found.' }
    }

    // T7.D5: reads speak the EFFECTIVE status through the one pure predicate
    // and never write — opportunistic EXPIRED persistence is the gateway's.
    const status = effectiveQuoteStatus({ status: quote.status as QuoteStatusV3, validUntil: quote.validUntil }, new Date())

    // T7.D3: the contract frequency is elected at accept_quote — until then
    // the read bundles the product's offered options against the quote's
    // priced variants (no monthly: it is a display figure, not an offer).
    const product = await context.db.product.findUnique({ where: { id: quote.productId } })
    const freqOptions = product?.paymentFrequencyOptions as Record<string, unknown> | null
    const variant: Record<string, number | null> = {
      annual: quote.premiumAnnual,
      semi_annual: quote.premiumSemiAnnual,
      quarterly: quote.premiumQuarterly,
    }
    const payment_options = Object.keys(freqOptions ?? {})
      .filter((opt) => variant[opt] != null)
      .map((opt) => ({ option: opt, amount: variant[opt]!, currency: quote.currency }))

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
        status,
        validUntil: quote.validUntil.toISOString(),
        coverages,
        addonsSelected,
        payment_options,
      },
      message: `Quote info: ${quote.premiumAnnual} RON/year. Status: ${status}.`,
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

    // Find quote via the conversation's active application (B4)
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'No application found.' }
    }

    const quote = await context.db.quote.findUnique({
      where: { applicationId: application.id },
    })
    if (!quote) {
      return { success: false, error: 'No quote found.' }
    }

    if (quote.status !== 'ISSUED') {
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
// cancel_quote (D1.5)
// ─────────────────────────────────────────────

export const cancelQuote: ToolHandler = async (_args, context) => {
  try {
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'no_open_application: no application found.' }
    }
    const quote = await context.db.quote.findFirst({
      where: { applicationId: application.id, status: 'ISSUED' },
      orderBy: { createdAt: 'desc' },
    })
    if (!quote) {
      return { success: false, error: 'no_issued_quote: there is no issued quote to cancel.' }
    }
    // The transition table is the SSOT; expiry never lives here — the
    // gateway persists EXPIRED pre-legality (erratum 1), so an expired quote
    // is rejected before this handler runs.
    if (!canQuoteTransition(quote.status as QuoteStatusV3, 'CANCELLED')) {
      return { success: false, error: `illegal_status_transition: a ${quote.status} quote cannot be cancelled.` }
    }
    const cas = await context.db.quote.updateMany({
      where: { id: quote.id, status: 'ISSUED' },
      data: { status: 'CANCELLED' },
    })
    if (cas.count === 0) {
      return { success: false, error: 'illegal_status_transition: the quote left ISSUED between legality and apply.' }
    }
    // T13.D2 recovery: release the conversation pointer. The frozen
    // application stays as the audit record of what was priced — the only
    // change path is a NEW application, prefilled via B4 proposals.
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: { activeApplicationId: null },
    })
    return {
      success: true,
      effects: ['terminal'],
      data: { cancelledQuoteId: quote.id, applicationId: application.id },
      message: 'Quote cancelled. The application stays frozen for the record — to get a different quote, start a new application (previous answers are offered as prefill).',
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
    // B4: selection lives on the Application (select_coverage is the sole
    // writer) — modifying a quote just expires it; the customer re-selects
    // with select_coverage and generates a fresh quote. No answers are
    // touched and the application is not "reopened" (it stayed OPEN).
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'No application found.' }
    }

    const quote = await context.db.quote.findUnique({
      where: { applicationId: application.id },
    })
    if (!quote) {
      return { success: false, error: 'No quote found to modify.' }
    }

    await context.db.quote.update({
      where: { id: quote.id },
      data: { status: 'EXPIRED' },
    })

    return {
      success: true,
      data: {
        modificationStarted: true,
        oldQuoteId: quote.id,
        applicationId: application.id,
      },
      effects: ['re_rating'],
      message: 'Quote expired. Change the coverage with select_coverage, then generate an updated quote.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
