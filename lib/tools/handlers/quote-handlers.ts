/**
 * Quote Handlers
 *
 * generate_quote, get_quote_info, accept_quote, cancel_quote
 */

import { calculateQuote } from '@/lib/engines/quote-engine'
import type { QuoteInput } from '@/lib/engines/quote-engine'
import { decideQuoteIssue } from '@/lib/engines/quote-decision'
import { canQuoteTransition, effectiveQuoteStatus, type QuoteStatusV3 } from '@/lib/engines/quote-lifecycle'
import { disclosuresRequired, type DisclosureRef } from '@/lib/engines/disclosures'
import { buildSchedule, INSTALLMENTS_BY_FREQUENCY, type PaymentFrequency } from '@/lib/engines/payment-schedule'
import { getProductDisclosureDocuments } from '@/lib/documents/registry'
import { toQuoteCoverageRow, type QuoteCoverageRow } from '@/lib/products/coverage-display'
import { evaluateEligibility } from '@/lib/engines/eligibility'
import { deriveSuitability } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { getAge } from '@/lib/customer/profile-service'
import { createReferralWorkItem } from '@/lib/work-items/referral'
import { generateSuitabilityReport } from '@/lib/compliance/suitability-report'
import { loadActiveApplication } from './application-handlers'
import type { ToolContext, ToolHandler } from '@/lib/tools/types'
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
      // T7.D4: the decision is an audit fact even when it demands data —
      // keepWrites exempts it from the P0-2 rollback-on-rejection.
      await context.db.application.update({ where: { id: application.id }, data: { quoteDecision: decided } })
      return { success: false, error: 'requires_identity: the quote needs identity facts first.', data: { needs: decision.needs }, keepWrites: true }
    }
    if (decision.outcome === 'rejected') {
      await context.db.application.update({ where: { id: application.id }, data: { quoteDecision: decided } })
      return { success: false, error: `${decision.reason}: the quote decision rejected the application.`, keepWrites: true }
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
      // T15: toQuoteCoverageRow threads unit/maxUnits/deductibleDays (+ the
      // code-mapped capPeriod) through — the card must carry ALL the numbers.
      .map(ca => toQuoteCoverageRow({
        amount: ca.amount,
        currency: ca.currency,
        coverageType: {
          code: ca.coverageType.code,
          name: ca.coverageType.name as { en: string; ro: string },
          unit: ca.coverageType.unit,
          maxUnits: ca.coverageType.maxUnits,
          deductibleDays: ca.coverageType.deductibleDays,
        },
      }))

    let addonPricingRule: { premiumAnnual: number } | null = null
    let addonCoverages: QuoteCoverageRow[] = []
    if (application.includesAddon) {
      const addon = await context.db.addon.findFirst({
        where: { productId: application.productId, isActive: true },
        include: { pricingRules: true, coverageAmounts: { include: { coverageType: true } } },
      })
      if (addon) {
        const matchingRule = addon.pricingRules.find(r => customerAge >= r.minAge && customerAge <= r.maxAge)
        if (matchingRule) addonPricingRule = { premiumAnnual: matchingRule.premiumAnnual }
        addonCoverages = addon.coverageAmounts.map(ca => toQuoteCoverageRow({
          amount: ca.amount,
          currency: ca.currency,
          coverageType: {
            code: ca.coverageType.code,
            name: ca.coverageType.name as { en: string; ro: string },
            unit: ca.coverageType.unit,
            maxUnits: ca.coverageType.maxUnits,
            deductibleDays: ca.coverageType.deductibleDays,
          },
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
      // T15 conduct line: the card informs, prose sells — the factual lead
      // stays for the model's own grounding, the instruction stops it from
      // re-listing the card's numbers above the card.
      message: `Quote issued: ${result.premiumAnnual} RON/year (${result.premiumMonthly} RON/month), valid until ${result.validUntil.toISOString().split('T')[0]}. The application is now frozen — changes require cancelling the quote and re-applying. A quote card with ALL the numbers is shown — in prose do NOT repeat prices or coverage figures; give ONE short personalized reason to act, anchored to what you know about this customer, leading with the strongest benefit.`,
      uiAction: {
        type: 'show_quote',
        payload: {
          quoteId: quote.id,
          tierName: result.pricingTierLabel,
          levelName: result.pricingLevelLabel,
          includesAddon: application.includesAddon,
          premiumAnnual: result.premiumAnnual,
          premiumMonthly: result.premiumMonthly,
          currency: quote.currency, // T15: the quote's currency, top level
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

    // D2.3 (T7.D2): the disclosure gate — which current documents still lack
    // an ack bound to their exact (kind, version, language) identity
    const disclosureDocs = await getProductDisclosureDocuments(quote.productId, context.language ?? 'ro', context.db)
    const ackRows = await context.db.disclosureAck.findMany({ where: { quoteId: quote.id } })
    const disclosures_required = disclosuresRequired(
      disclosureDocs.map((d) => ({ kind: d.kind as DisclosureRef['kind'], version: d.version, language: d.language })),
      ackRows.map((a) => ({ kind: a.kind as DisclosureRef['kind'], version: a.version, language: a.language })),
    )

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
        disclosures_required,
        documents: disclosureDocs.map((d) => ({ kind: d.kind, version: d.version, language: d.language, url: `/api/documents/${d.id}` })),
      },
      message: `Quote info: ${quote.premiumAnnual} RON/year. Status: ${status}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// get_acceptance_bundle (T23)
// ─────────────────────────────────────────────

/** Customer-facing titles for the two static disclosure kinds — the Document
 * registry row has no title column; the kind IS the identity. */
const DISCLOSURE_TITLES: Record<string, { en: string; ro: string }> = {
  IPID: { en: 'Insurance Product Information Document (IPID)', ro: 'Document de informare (IPID)' },
  TERMS: { en: 'Terms and Conditions', ro: 'Termeni și condiții' },
}

interface AcceptanceQuoteRow {
  id: string
  productId: string
  premiumAnnual: number
  premiumSemiAnnual: number | null
  premiumQuarterly: number | null
  currency: string
  coverages: unknown
  addonsSelected: unknown
}

/**
 * The show_acceptance payload, shared by the get_acceptance_bundle read and
 * the acknowledge_disclosures re-emit: offer recap, the disclosure document
 * links, the frequency comparison (Product.paymentFrequencyOptions ∩ the
 * quote's precomputed variants — same intersection as get_quote_info's
 * payment_options) and the disclosuresAcked gate.
 */
async function buildAcceptanceBundlePayload(quote: AcceptanceQuoteRow, context: ToolContext): Promise<Record<string, unknown>> {
  const product = await context.db.product.findUnique({ where: { id: quote.productId }, select: { paymentFrequencyOptions: true } })
  const freqOptions = product?.paymentFrequencyOptions as Record<string, unknown> | null
  const variant: Record<string, number | null> = {
    annual: quote.premiumAnnual,
    semi_annual: quote.premiumSemiAnnual,
    quarterly: quote.premiumQuarterly,
  }
  const frequencies = (Object.keys(INSTALLMENTS_BY_FREQUENCY) as PaymentFrequency[])
    .filter((opt) => Object.keys(freqOptions ?? {}).includes(opt) && variant[opt] != null)
    .map((opt) => {
      const perInstallment = variant[opt]!
      const installments = INSTALLMENTS_BY_FREQUENCY[opt]
      return {
        option: opt,
        perInstallment,
        installments,
        // display math from the precomputed fields — the ACTUAL schedule is
        // built at accept in integer minor units (buildSchedule)
        totalPerYear: Math.round(perInstallment * installments * 100) / 100,
      }
    })
  const language = context.language ?? 'ro'
  const docs = await getProductDisclosureDocuments(quote.productId, language, context.db)
  const acks = await context.db.disclosureAck.findMany({ where: { quoteId: quote.id } })
  const disclosuresAcked = disclosuresRequired(
    docs.map((d) => ({ kind: d.kind as DisclosureRef['kind'], version: d.version, language: d.language })),
    acks.map((a) => ({ kind: a.kind as DisclosureRef['kind'], version: a.version, language: a.language })),
  ).length === 0
  const coverages = quote.coverages as { pricingTierLabel?: { en: string; ro: string }; pricingLevelLabel?: { en: string; ro: string } } | null
  return {
    quoteId: quote.id,
    tierName: coverages?.pricingTierLabel ?? null,
    levelName: coverages?.pricingLevelLabel ?? null,
    includesAddon: quote.addonsSelected != null,
    premium: {
      annual: quote.premiumAnnual,
      semiAnnual: quote.premiumSemiAnnual,
      quarterly: quote.premiumQuarterly,
      currency: quote.currency,
    },
    frequencies,
    documents: docs.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: DISCLOSURE_TITLES[d.kind] ?? { en: d.kind, ro: d.kind },
      // plain registry URL — the card renders a plain <a target="_blank"
      // rel="noopener"> so the SPA survives the navigation regardless of the
      // route's auth story (T21 owns the auth fix)
      url: `/api/documents/${d.id}`,
    })),
    disclosuresAcked,
  }
}

/**
 * T23: the acceptance-card read. Runs on the plain executor path (never in
 * the gateway tx — context.db IS the global client there); the uiAction rides
 * ToolResult.uiAction and the orchestrator emits ui_action for any tool
 * result that carries one, read or commit.
 *
 * Identity note: the card may render while identity is below
 * verified_channel — the Accept click is then rejected by the gateway
 * legality wall (requires_identity envelope) and the model narrates the gap.
 * Acceptable: the funnel does OTP before acceptance (T27/T28 own the
 * ordering); the card gates Accept only on disclosuresAcked + frequency.
 */
export const getAcceptanceBundle: ToolHandler = async (_args, context) => {
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
      return { success: false, error: 'no_issued_quote: there is no issued quote to accept.' }
    }
    if (effectiveQuoteStatus({ status: quote.status as QuoteStatusV3, validUntil: quote.validUntil }, new Date()) === 'EXPIRED') {
      return { success: false, error: 'quote_expired: the quote expired — cancel it and start a new application for a fresh price.' }
    }
    const payload = await buildAcceptanceBundlePayload(quote, context)
    return {
      success: true,
      data: payload,
      message:
        'Acceptance card shown: document links, the disclosure-acknowledgment checkbox and the payment-frequency comparison with the Accept button. ' +
        'In prose do NOT repeat the amounts or list the frequencies — invite the customer to read the documents, tick the confirmation and choose how they want to pay.',
      uiAction: { type: 'show_acceptance', payload },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// accept_quote
// ─────────────────────────────────────────────

/**
 * D2.5 (T7.D6): NARROW accept — CAS ISSUED→ACCEPTED with the immutable
 * acceptance evidence (paymentFrequency + acceptedAt, written HERE and never
 * again) and the transactional schedule (contradiction #3: integer minor
 * units, the live money truth from this moment). NO Policy (it is created
 * at first successful settlement — contradiction #5) and NO conversation
 * close (contradiction #11). Legality (expiry/transition/identity/
 * disclosures) lives in the pure acceptQuoteLegality consumed by
 * deriveAndExpose — never re-decided here (erratum 1).
 */
export const acceptQuote: ToolHandler = async (args, context) => {
  try {
    const paymentOption = args.paymentOption as PaymentFrequency
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'no_open_application: no application found.' }
    }
    const quote = await context.db.quote.findFirst({
      where: { applicationId: application.id, status: 'ISSUED' },
      orderBy: { createdAt: 'desc' },
    })
    if (!quote) {
      return { success: false, error: 'no_issued_quote: there is no issued quote to accept.' }
    }
    // the elected frequency must be one the PRODUCT offers (T7.D3)
    const product = await context.db.product.findUnique({ where: { id: quote.productId }, select: { paymentFrequencyOptions: true } })
    const offered = Object.keys((product?.paymentFrequencyOptions as Record<string, unknown> | null) ?? {})
    if (!offered.includes(paymentOption)) {
      return { success: false, error: `invalid_args: payment option "${paymentOption}" is not offered for this product (${offered.join(', ')}).` }
    }

    const now = new Date()
    const cas = await context.db.quote.updateMany({
      where: { id: quote.id, status: 'ISSUED' },
      data: { status: 'ACCEPTED', paymentFrequency: paymentOption, acceptedAt: now },
    })
    if (cas.count === 0) {
      return { success: false, error: 'illegal_status_transition: the quote left ISSUED between legality and apply.' }
    }
    // T8: the accepted quote FULFILS the customer's active purchase intent —
    // inside the same apply tx, so intent truth never lags the acceptance.
    await context.db.purchaseIntent.updateMany({
      where: { customerId: quote.customerId, status: 'active' },
      data: { status: 'fulfilled' },
    })
    const rows = buildSchedule({ premiumAnnual: quote.premiumAnnual, frequency: paymentOption, startAt: now })
    const schedule = await context.db.paymentSchedule.create({
      data: {
        quoteId: quote.id,
        customerId: quote.customerId,
        frequency: paymentOption,
        totalInstallments: rows.length,
        currency: quote.currency,
        installments: { create: rows },
      },
      include: { installments: { orderBy: { sequence: 'asc' } } },
    })

    trackQuoteAccepted(quote.customerId, quote.premiumAnnual)

    const first = schedule.installments[0]
    return {
      success: true,
      data: {
        quoteId: quote.id,
        paymentOption,
        acceptedAt: now.toISOString(),
        scheduleId: schedule.id,
        totalInstallments: schedule.totalInstallments,
        firstInstallment: { amountMinor: first.amountMinor, dueAt: first.dueAt.toISOString() },
      },
      message:
        `Quote accepted with ${paymentOption} payment: ${schedule.totalInstallments} installment(s), first ${(first.amountMinor / 100).toFixed(2)} RON due now. Payment follows — the policy is issued at the first successful payment.`,
      uiAction: {
        type: 'show_quote_accepted',
        payload: {
          quoteId: quote.id,
          paymentOption,
          firstInstallment: { amountMinor: first.amountMinor, dueAt: first.dueAt.toISOString() },
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// acknowledge_disclosures (D2.3, T7.D2)
// ─────────────────────────────────────────────

export const acknowledgeDisclosures: ToolHandler = async (_args, context) => {
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
      return { success: false, error: 'no_issued_quote: there is no issued quote to acknowledge disclosures for.' }
    }
    const language = context.language ?? 'ro'
    const docs = await getProductDisclosureDocuments(quote.productId, language, context.db)
    const acks = await context.db.disclosureAck.findMany({ where: { quoteId: quote.id } })
    // one row per still-missing document, inside the gateway tx; duplicates
    // are answered by the ledger replay (identical args on the same quote)
    // plus the @@unique([quoteId, kind, version, language]) belt
    const missing = disclosuresRequired(
      docs.map((d) => ({ kind: d.kind as DisclosureRef['kind'], version: d.version, language: d.language, documentId: d.id })),
      acks.map((a) => ({ kind: a.kind as DisclosureRef['kind'], version: a.version, language: a.language })),
    )
    for (const doc of missing) {
      await context.db.disclosureAck.create({
        data: {
          quoteId: quote.id,
          customerId: quote.customerId,
          documentId: doc.documentId,
          kind: doc.kind,
          version: doc.version,
          language: doc.language,
          actor: String(context.actor ?? 'agent'),
          sourceCommitId: context.commitId ?? null,
        },
      })
    }
    // T23: the ack re-emits the acceptance card — the checkbox click marked
    // the previous card answered (inert), so the fresh card renders the
    // checkbox checked+disabled with Accept gated only on the frequency
    // choice. disclosuresAcked recomputes over the rows just written.
    const bundle = await buildAcceptanceBundlePayload(quote, context)
    return {
      success: true,
      data: { acknowledged: missing.map(({ kind, version, language: lang }) => ({ kind, version, language: lang })) },
      message: missing.length > 0
        ? `Disclosure documents acknowledged: ${missing.map((m) => `${m.kind} v${m.version}`).join(', ')}.`
        : 'All disclosure documents were already acknowledged.',
      uiAction: { type: 'show_acceptance', payload: bundle },
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

// modify_quote died at D1.7 (T13.D2): the quote is the immutable priced
// artifact — the only change path is cancel_quote + a new application.
