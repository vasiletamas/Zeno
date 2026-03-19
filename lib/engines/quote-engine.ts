/**
 * Quote Engine
 *
 * Pure function — no DB access.
 * Receives resolved pricing data as input, returns calculated quote.
 *
 * All premium arithmetic is in RON.
 */

// ==========================================
// TYPES
// ==========================================

export interface QuoteInput {
  tierCode: string
  levelCode: string
  customerAge: number
  includesAddon: boolean
  paymentFrequency: 'annual' | 'semi_annual' | 'quarterly'
  pricingLevel: { premiumAnnual: number; name: { en: string; ro: string } }
  pricingTier: { name: { en: string; ro: string } }
  baseCoverages: {
    code: string
    name: { en: string; ro: string }
    amount: number
    currency: string
  }[]
  addonPricingRule: { premiumAnnual: number } | null
  addonCoverages: {
    code: string
    name: { en: string; ro: string }
    amount: number
    currency: string
  }[]
  quoteValidityDays: number
}

export interface QuoteResult {
  premiumAnnual: number
  premiumMonthly: number
  premiumSemiAnnual: number
  premiumQuarterly: number
  basePremiumAnnual: number
  addonPremiumAnnual: number
  baseCoverages: {
    code: string
    name: { en: string; ro: string }
    amount: number
    currency: string
  }[]
  addonCoverages: {
    code: string
    name: { en: string; ro: string }
    amount: number
    currency: string
  }[]
  pricingTierLabel: { en: string; ro: string }
  pricingLevelLabel: { en: string; ro: string }
  validUntil: Date
}

// ==========================================
// CALCULATION
// ==========================================

/**
 * Calculate a quote from resolved pricing data.
 *
 * 1. basePremiumAnnual = pricingLevel.premiumAnnual
 * 2. addonPremiumAnnual = addonPricingRule?.premiumAnnual ?? 0
 * 3. premiumAnnual = base + addon
 * 4. premiumMonthly = round(annual / 12, 2)
 * 5. premiumSemiAnnual = round(annual / 2, 2)
 * 6. premiumQuarterly = round(annual / 4, 2)
 * 7. validUntil = now + quoteValidityDays
 */
export function calculateQuote(input: QuoteInput): QuoteResult {
  const basePremiumAnnual = input.pricingLevel.premiumAnnual
  const addonPremiumAnnual = input.addonPricingRule?.premiumAnnual ?? 0
  const premiumAnnual = basePremiumAnnual + addonPremiumAnnual

  const premiumMonthly = Math.round((premiumAnnual / 12) * 100) / 100
  const premiumSemiAnnual = Math.round((premiumAnnual / 2) * 100) / 100
  const premiumQuarterly = Math.round((premiumAnnual / 4) * 100) / 100

  const validUntil = new Date(Date.now() + input.quoteValidityDays * 24 * 60 * 60 * 1000)

  return {
    premiumAnnual,
    premiumMonthly,
    premiumSemiAnnual,
    premiumQuarterly,
    basePremiumAnnual,
    addonPremiumAnnual,
    baseCoverages: input.baseCoverages,
    addonCoverages: input.includesAddon ? input.addonCoverages : [],
    pricingTierLabel: input.pricingTier.name,
    pricingLevelLabel: input.pricingLevel.name,
    validUntil,
  }
}
