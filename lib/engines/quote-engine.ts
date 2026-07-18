/**
 * Quote Engine
 *
 * Pure function — no DB access.
 * Receives resolved pricing data as input, returns calculated quote.
 *
 * Premium arithmetic is in the pricing level's currency (RON). T18: a
 * tariff denominated in another currency (EUR addon rate card) must arrive
 * with an FX reference — the engine converts it, never sums naked numbers
 * across denominations.
 */

/**
 * One dated FX reference (T18). `rate` is quote-per-base — RON per EUR —
 * so `amountInQuote = amountInBase * rate`. Obtained from lib/engines/fx
 * providers (BNR daily XML or the fixed env rate) and frozen verbatim into
 * Quote.ratingInputs.fx at issuance.
 */
export interface FxReference {
  rate: number
  date: string
  source: string
}

// ==========================================
// TYPES
// ==========================================

/**
 * One coverage line, passed through untouched. The qualifier fields (T15:
 * unit/caps/franchise) are optional so callers with pure lump-sum data
 * stay valid; the quote handler always supplies them from the catalog.
 */
export interface QuoteCoverage {
  code: string
  name: { en: string; ro: string }
  amount: number
  currency: string
  unit?: 'per_day' | 'lump_sum'
  maxUnits?: number
  deductibleDays?: number
  capPeriod?: 'per_year' | 'per_event'
}

export interface QuoteInput {
  tierCode: string
  levelCode: string
  customerAge: number
  includesAddon: boolean
  paymentFrequency: 'annual' | 'semi_annual' | 'quarterly'
  pricingLevel: { premiumAnnual: number; name: { en: string; ro: string }; currency?: string }
  pricingTier: { name: { en: string; ro: string } }
  baseCoverages: QuoteCoverage[]
  addonPricingRule: { premiumAnnual: number; currency?: string } | null
  addonCoverages: QuoteCoverage[]
  quoteValidityDays: number
  /** T18: required exactly when the addon tariff's currency differs from the level's */
  fx?: FxReference | null
}

export interface QuoteResult {
  premiumAnnual: number
  premiumMonthly: number
  premiumSemiAnnual: number
  premiumQuarterly: number
  basePremiumAnnual: number
  addonPremiumAnnual: number
  baseCoverages: QuoteCoverage[]
  addonCoverages: QuoteCoverage[]
  pricingTierLabel: { en: string; ro: string }
  pricingLevelLabel: { en: string; ro: string }
  validUntil: Date
  /** T18: the FX reference actually used for conversion — null when no conversion happened */
  fx: FxReference | null
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
  // C2.4 last-line invariant: the D1 eligibility gate rejects BEFORE pricing
  // (addon_age_band_unavailable is a fact, #9) — reaching here with the
  // addon selected but no matched band is a programming error, never a
  // silent price 0.
  if (input.includesAddon && input.addonPricingRule === null) {
    throw new Error('addon_age_band_unavailable: includesAddon=true but no AddonPricingRule matched customerAge — the eligibility gate must reject before pricing')
  }
  const basePremiumAnnual = input.pricingLevel.premiumAnnual
  // T18 currency guard: an addon tariff in a different denomination than the
  // level NEVER sums naked — it converts through the supplied FX reference
  // (rate is quote-per-base, RON per EUR) or the calculation refuses.
  let addonPremiumAnnual = input.addonPricingRule?.premiumAnnual ?? 0
  let fxUsed: FxReference | null = null
  const levelCurrency = input.pricingLevel.currency
  const addonCurrency = input.addonPricingRule?.currency
  if (input.includesAddon && input.addonPricingRule && levelCurrency && addonCurrency && addonCurrency !== levelCurrency) {
    if (!input.fx) {
      throw new Error(`mixed_currency_without_conversion: addon ${addonCurrency} vs level ${levelCurrency} — an FX reference is required`)
    }
    addonPremiumAnnual = Math.round(input.addonPricingRule.premiumAnnual * input.fx.rate * 100) / 100
    fxUsed = input.fx
  }
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
    fx: fxUsed,
  }
}
