import { describe, it, expect } from 'vitest'
import { deriveAddonAgeRules, evaluateEligibility } from '@/lib/engines/eligibility'
import { calculateQuote, type QuoteInput } from '@/lib/engines/quote-engine'

describe('deriveAddonAgeRules', () => {
  it('derives one between-rule spanning the seeded band envelope (18..64)', () => {
    const bands = [
      { minAge: 18, maxAge: 30 }, { minAge: 31, maxAge: 45 }, { minAge: 46, maxAge: 64 },
    ]
    const rules = deriveAddonAgeRules(bands)
    expect(rules).toEqual([{ id: 'addon_age_band', subject: 'addon', fact: 'age', op: 'between', value: [18, 64], reason: 'addon_age_band_unavailable' }])
    const r = evaluateEligibility({ version: 1, rules }, { age: 70 }, 'addon')
    expect(r.verdict).toBe('ineligible')
    expect(r.failedRules[0].reason).toBe('addon_age_band_unavailable')
  })
  it('throws on a gap between bands — the envelope must not silently declare hole-ages eligible (C2 erratum 4)', () => {
    expect(() => deriveAddonAgeRules([{ minAge: 18, maxAge: 30 }, { minAge: 46, maxAge: 64 }])).toThrow(/contiguous/)
  })
  it('no bands → no rules (nothing to derive)', () => {
    expect(deriveAddonAgeRules([])).toEqual([])
  })
})

describe('calculateQuote addon invariant', () => {
  const base: QuoteInput = {
    tierCode: 'standard', levelCode: 'level_1', customerAge: 70, includesAddon: true,
    paymentFrequency: 'annual',
    pricingLevel: { premiumAnnual: 1000, name: { en: 'I', ro: 'I' } },
    pricingTier: { name: { en: 'Standard', ro: 'Standard' } },
    baseCoverages: [], addonPricingRule: null, addonCoverages: [], quoteValidityDays: 30,
  }
  it('throws instead of silently pricing the addon at 0 when no age band matched', () => {
    expect(() => calculateQuote(base)).toThrow(/addon_age_band_unavailable/)
  })
  it('still prices addon-free quotes with a null rule', () => {
    expect(() => calculateQuote({ ...base, includesAddon: false })).not.toThrow()
  })
})
