import { describe, it, expect } from 'vitest'
import { calculateQuote, type QuoteInput } from '@/lib/engines/quote-engine'

// ==========================================
// Test helpers using exact pricing from seed-product.ts
// ==========================================

/**
 * Build a QuoteInput with sensible defaults.
 * Pricing data matches prisma/seeds/seed-product.ts exactly — T17: the
 * addon rate card is denominated in EUR (its true denomination), so
 * addon-inclusive cases carry the currencies + the default fixed FX
 * reference (5.06 RON/EUR) and expect CONVERTED premiums.
 */
function buildInput(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    tierCode: 'standard',
    levelCode: 'level_1',
    customerAge: 30,
    includesAddon: false,
    paymentFrequency: 'annual',
    pricingLevel: { premiumAnnual: 190, name: { en: 'Level I', ro: 'Nivelul I' } },
    pricingTier: { name: { en: 'Standard', ro: 'Standard' } },
    baseCoverages: [
      { code: 'DEATH_ANY_CAUSE', name: { en: 'Death from any cause', ro: 'Deces din orice cauză' }, amount: 30000, currency: 'RON' },
      { code: 'PERMANENT_INVALIDITY_ACCIDENT', name: { en: 'Permanent invalidity from accident', ro: 'Invaliditate permanentă' }, amount: 10000, currency: 'RON' },
      { code: 'SURGICAL_INTERVENTION_ACCIDENT', name: { en: 'Surgical interventions', ro: 'Intervenții chirurgicale' }, amount: 4000, currency: 'RON' },
      { code: 'HOSPITALIZATION_ACCIDENT', name: { en: 'Hospitalization', ro: 'Spitalizare' }, amount: 20, currency: 'RON' },
    ],
    addonPricingRule: null,
    addonCoverages: [],
    quoteValidityDays: 30,
    ...overrides,
  }
}

const addonCoverages = [
  { code: 'TREATMENT_COSTS', name: { en: 'Medical treatment costs abroad', ro: 'Cheltuieli tratament medical' }, amount: 2000000, currency: 'EUR' },
  { code: 'HOSPITALIZATION_ABROAD', name: { en: 'Daily hospitalization abroad', ro: 'Indemnizație spitalizare' }, amount: 100, currency: 'EUR' },
  { code: 'POST_TREATMENT_MEDICATION', name: { en: 'Post-treatment medication', ro: 'Medicație post-tratament' }, amount: 50000, currency: 'EUR' },
]

// T17: the seeded rate card's true shape — RON level, EUR addon tariff,
// converted through the default fixed reference (FX_EUR_RON 5.06)
const RON_LEVEL_1 = { premiumAnnual: 190, name: { en: 'Level I', ro: 'Nivelul I' }, currency: 'RON' }
const FX_506 = { rate: 5.06, date: '2026-07-17', source: 'fixed:env' }
const eurAddonRule = (premiumAnnual: number) => ({ premiumAnnual, currency: 'EUR' })

// ==========================================
// Tests
// ==========================================

describe('calculateQuote', () => {
  // Test 1: Standard Level I, no addon
  it('calculates Standard Level I without addon: premiumAnnual = 190', () => {
    const result = calculateQuote(buildInput())
    expect(result.premiumAnnual).toBe(190)
    expect(result.basePremiumAnnual).toBe(190)
    expect(result.addonPremiumAnnual).toBe(0)
  })

  // Test 2: Standard Level II, no addon
  it('calculates Standard Level II without addon: premiumAnnual = 290', () => {
    const result = calculateQuote(buildInput({
      levelCode: 'level_2',
      pricingLevel: { premiumAnnual: 290, name: { en: 'Level II', ro: 'Nivelul II' } },
    }))
    expect(result.premiumAnnual).toBe(290)
    expect(result.basePremiumAnnual).toBe(290)
  })

  // Test 3: Optim Level III, no addon
  it('calculates Optim Level III without addon: premiumAnnual = 430', () => {
    const result = calculateQuote(buildInput({
      tierCode: 'optim',
      levelCode: 'level_3',
      pricingTier: { name: { en: 'Optim', ro: 'Optim' } },
      pricingLevel: { premiumAnnual: 430, name: { en: 'Level III', ro: 'Nivelul III' } },
    }))
    expect(result.premiumAnnual).toBe(430)
    expect(result.basePremiumAnnual).toBe(430)
  })

  // Test 4: Standard Level I + addon (age 25, band 18-30 = 200 EUR → 1012 RON @5.06)
  it('calculates Standard Level I with addon age 25: premiumAnnual = 190 + 200*5.06 = 1202', () => {
    const result = calculateQuote(buildInput({
      customerAge: 25,
      includesAddon: true,
      pricingLevel: RON_LEVEL_1,
      addonPricingRule: eurAddonRule(200),
      addonCoverages,
      fx: FX_506,
    }))
    expect(result.premiumAnnual).toBe(1202)
    expect(result.basePremiumAnnual).toBe(190)
    expect(result.addonPremiumAnnual).toBe(1012)
  })

  // Test 5: Standard Level I + addon (age 50, band 46-55 = 500 EUR → 2530 RON @5.06)
  it('calculates Standard Level I with addon age 50: premiumAnnual = 190 + 500*5.06 = 2720', () => {
    const result = calculateQuote(buildInput({
      customerAge: 50,
      includesAddon: true,
      pricingLevel: RON_LEVEL_1,
      addonPricingRule: eurAddonRule(500),
      addonCoverages,
      fx: FX_506,
    }))
    expect(result.premiumAnnual).toBe(2720)
    expect(result.basePremiumAnnual).toBe(190)
    expect(result.addonPremiumAnnual).toBe(2530)
  })

  // Test 6: Payment frequency — monthly
  it('calculates premiumMonthly = round(1202/12, 2) = 100.17', () => {
    const result = calculateQuote(buildInput({
      includesAddon: true,
      pricingLevel: RON_LEVEL_1,
      addonPricingRule: eurAddonRule(200),
      addonCoverages,
      fx: FX_506,
    }))
    expect(result.premiumAnnual).toBe(1202)
    expect(result.premiumMonthly).toBe(100.17)
  })

  // Test 7: Payment frequency — quarterly
  it('calculates premiumQuarterly = round(1202/4, 2) = 300.5', () => {
    const result = calculateQuote(buildInput({
      paymentFrequency: 'quarterly',
      includesAddon: true,
      pricingLevel: RON_LEVEL_1,
      addonPricingRule: eurAddonRule(200),
      addonCoverages,
      fx: FX_506,
    }))
    expect(result.premiumQuarterly).toBe(300.5)
  })

  // Test 8: No addon (null rule) → addonPremiumAnnual = 0
  it('sets addonPremiumAnnual to 0 when addonPricingRule is null', () => {
    const result = calculateQuote(buildInput({
      includesAddon: false,
      addonPricingRule: null,
    }))
    expect(result.addonPremiumAnnual).toBe(0)
  })

  // Test 9: Coverages pass through correctly
  it('passes through base coverages and addon coverages', () => {
    const result = calculateQuote(buildInput({
      includesAddon: true,
      addonPricingRule: { premiumAnnual: 200 },
      addonCoverages,
    }))
    expect(result.baseCoverages).toHaveLength(4)
    expect(result.baseCoverages[0].code).toBe('DEATH_ANY_CAUSE')
    expect(result.addonCoverages).toHaveLength(3)
    expect(result.addonCoverages[0].code).toBe('TREATMENT_COSTS')
    expect(result.addonCoverages[0].amount).toBe(2000000)
  })

  // Test 9b: Addon coverages are empty when includesAddon is false
  it('returns empty addonCoverages when includesAddon is false', () => {
    const result = calculateQuote(buildInput({
      includesAddon: false,
      addonPricingRule: { premiumAnnual: 200 },
      addonCoverages,
    }))
    expect(result.addonCoverages).toHaveLength(0)
  })

  // Test 10: validUntil is ~30 days from now
  it('sets validUntil to approximately 30 days from now', () => {
    const before = Date.now()
    const result = calculateQuote(buildInput({ quoteValidityDays: 30 }))
    const after = Date.now()

    const expectedMin = before + 30 * 24 * 60 * 60 * 1000
    const expectedMax = after + 30 * 24 * 60 * 60 * 1000

    expect(result.validUntil.getTime()).toBeGreaterThanOrEqual(expectedMin)
    expect(result.validUntil.getTime()).toBeLessThanOrEqual(expectedMax)
  })

  // Test: Labels pass through
  it('passes through pricing tier and level labels', () => {
    const result = calculateQuote(buildInput({
      pricingTier: { name: { en: 'Standard', ro: 'Standard' } },
      pricingLevel: { premiumAnnual: 190, name: { en: 'Level I', ro: 'Nivelul I' } },
    }))
    expect(result.pricingTierLabel).toEqual({ en: 'Standard', ro: 'Standard' })
    expect(result.pricingLevelLabel).toEqual({ en: 'Level I', ro: 'Nivelul I' })
  })

  // Test: Semi-annual calculation
  it('calculates premiumSemiAnnual = round(2720/2, 2) = 1360', () => {
    const result = calculateQuote(buildInput({
      customerAge: 50,
      includesAddon: true,
      pricingLevel: RON_LEVEL_1,
      addonPricingRule: eurAddonRule(500),
      addonCoverages,
      fx: FX_506,
    }))
    expect(result.premiumSemiAnnual).toBe(1360)
  })

  // Test: Monthly for 190 (not evenly divisible by 12)
  it('calculates premiumMonthly for 190 = round(190/12, 2) = 15.83', () => {
    const result = calculateQuote(buildInput())
    expect(result.premiumMonthly).toBe(15.83)
  })

  // ── T18 (P4.2): currency guard + FX conversion ──────────────────────────

  describe('T18: currency guard', () => {
    it('same-currency addon: math unchanged, a supplied fx is ignored and NOT echoed', () => {
      const result = calculateQuote(buildInput({
        includesAddon: true,
        pricingLevel: { premiumAnnual: 190, name: { en: 'Level I', ro: 'Nivelul I' }, currency: 'RON' },
        addonPricingRule: { premiumAnnual: 200, currency: 'RON' },
        addonCoverages,
        fx: { rate: 5.06, date: '2026-07-17', source: 'fixed:env' },
      }))
      expect(result.premiumAnnual).toBe(390)
      expect(result.addonPremiumAnnual).toBe(200)
      expect(result.fx).toBeNull()
    })

    it('EUR addon vs RON level WITHOUT an fx reference throws mixed_currency_without_conversion', () => {
      expect(() => calculateQuote(buildInput({
        includesAddon: true,
        pricingLevel: { premiumAnnual: 190, name: { en: 'Level I', ro: 'Nivelul I' }, currency: 'RON' },
        addonPricingRule: { premiumAnnual: 200, currency: 'EUR' },
        addonCoverages,
      }))).toThrow(/mixed_currency_without_conversion: addon EUR vs level RON/)
    })

    it('EUR addon + fx 5.0: addon converts quote-per-base (RON per EUR) and the fx used echoes', () => {
      const fx = { rate: 5, date: '2026-07-17', source: 'fixed:env' }
      const result = calculateQuote(buildInput({
        includesAddon: true,
        pricingLevel: { premiumAnnual: 190, name: { en: 'Level I', ro: 'Nivelul I' }, currency: 'RON' },
        addonPricingRule: { premiumAnnual: 200, currency: 'EUR' },
        addonCoverages,
        fx,
      }))
      expect(result.addonPremiumAnnual).toBe(1000) // 200 EUR * 5.0 RON/EUR
      expect(result.premiumAnnual).toBe(1190)
      expect(result.fx).toEqual(fx)
    })

    it('currency-less inputs (legacy callers) behave exactly as before — no guard, no echo', () => {
      const result = calculateQuote(buildInput({
        includesAddon: true,
        addonPricingRule: { premiumAnnual: 200 },
        addonCoverages,
      }))
      expect(result.premiumAnnual).toBe(390)
      expect(result.fx).toBeNull()
    })
  })
})
