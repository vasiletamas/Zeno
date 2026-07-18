/**
 * derivePricingExamples (E1.4, T11.D1/D3) — pure, no DB; every number the
 * agent can utter pre-quote comes out of the SAME calculateQuote arithmetic
 * that prices real quotes, evaluated over the product's DECLARED grid
 * (Product.pricingExampleGrid — data, not code). Base and base+addon come
 * from the same pass; an addon age-band no-match is an explicit
 * ineligibility fact, never a silent 0 (#9 folded fix).
 */
import { calculateQuote, type QuoteInput, type FxReference } from '@/lib/engines/quote-engine'

export interface PricingExampleGrid {
  /**
   * Per-product declared variation parameter (T11.D1). Erratum 9: typed
   * open so future products can vary on other inputs — validated against
   * KNOWN_GRID_PARAMETERS at derivation time; unknown yields NO examples
   * (honest absence beats invented cells).
   */
  parameter: string
  samplePoints: number[]
  tiers: string[]
  levels: string[]
  includeAddonDelta: boolean
}
export const KNOWN_GRID_PARAMETERS = ['age'] as const

export interface PricingTreeLevel { code: string; name: { en: string; ro: string }; premiumAnnual: number; currency?: string }
export interface PricingTreeTier { code: string; name: { en: string; ro: string }; levels: PricingTreeLevel[] }
export interface PricingTreeAddonRule { minAge: number; maxAge: number; premiumAnnual: number; currency?: string }
export interface PricingTree { tiers: PricingTreeTier[]; addonRules: PricingTreeAddonRule[]; quoteValidityDays: number }

/**
 * T18: does this tree mix denominations (an addon tariff in a different
 * currency than some level)? Callers use it to obtain the FX reference ONCE
 * before deriving — trees without currency projections (legacy) never do.
 */
export function pricingTreeNeedsFx(tree: PricingTree): boolean {
  const ruleCurrencies = tree.addonRules.map((r) => r.currency).filter((c): c is string => c !== undefined)
  if (ruleCurrencies.length === 0) return false
  return tree.tiers.some((t) =>
    t.levels.some((l) => l.currency !== undefined && ruleCurrencies.some((rc) => rc !== l.currency)),
  )
}

export interface PricingExample {
  age: number
  tier: string
  level: string
  currency: 'RON'
  base: { premiumAnnual: number; premiumMonthly: number }
  withAddon:
    | { premiumAnnual: number; premiumMonthly: number; addonDelta: number }
    | { ineligible: true; reason: 'addon_age_band_unavailable' }
    | null
}

export function derivePricingExamples(tree: PricingTree, grid: PricingExampleGrid, fx: FxReference | null = null): PricingExample[] {
  if (!(KNOWN_GRID_PARAMETERS as readonly string[]).includes(grid.parameter)) return []
  const out: PricingExample[] = []
  for (const age of grid.samplePoints) {
    for (const tierCode of grid.tiers) {
      const tier = tree.tiers.find((t) => t.code === tierCode)
      if (!tier) continue
      for (const levelCode of grid.levels) {
        const level = tier.levels.find((l) => l.code === levelCode)
        if (!level) continue
        const baseInput: QuoteInput = {
          tierCode, levelCode, customerAge: age, includesAddon: false,
          paymentFrequency: 'annual',
          pricingLevel: { premiumAnnual: level.premiumAnnual, name: level.name, currency: level.currency },
          pricingTier: { name: tier.name },
          baseCoverages: [], addonPricingRule: null, addonCoverages: [],
          quoteValidityDays: tree.quoteValidityDays,
        }
        const base = calculateQuote(baseInput)
        let withAddon: PricingExample['withAddon'] = null
        if (grid.includeAddonDelta) {
          const rule = tree.addonRules.find((r) => age >= r.minAge && age <= r.maxAge)
          withAddon = rule
            ? (() => {
                // T18: the fx reference rides into the SAME arithmetic that
                // prices real quotes; the delta is the CONVERTED component
                // (engine output), so examples and quotes cannot drift.
                const q = calculateQuote({ ...baseInput, includesAddon: true, addonPricingRule: { premiumAnnual: rule.premiumAnnual, currency: rule.currency }, fx })
                return { premiumAnnual: q.premiumAnnual, premiumMonthly: q.premiumMonthly, addonDelta: q.addonPremiumAnnual }
              })()
            : { ineligible: true as const, reason: 'addon_age_band_unavailable' as const }
        }
        out.push({ age, tier: tierCode, level: levelCode, currency: 'RON',
          base: { premiumAnnual: base.premiumAnnual, premiumMonthly: base.premiumMonthly }, withAddon })
      }
    }
  }
  return out
}
