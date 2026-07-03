import { describe, it, expect } from 'vitest'
import { derivePricingExamples } from '@/lib/engines/pricing-examples'

// literals mirror prisma/seeds/seed-product.ts pricing rows
const tree = {
  quoteValidityDays: 30,
  tiers: [
    { code: 'standard', name: { en: 'Standard', ro: 'Standard' }, levels: [
      { code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premiumAnnual: 190 },
      { code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premiumAnnual: 390 },
    ] },
    { code: 'optim', name: { en: 'Optim', ro: 'Optim' }, levels: [
      { code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premiumAnnual: 230 },
      { code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premiumAnnual: 430 },
    ] },
  ],
  addonRules: [
    { minAge: 18, maxAge: 30, premiumAnnual: 200 },
    { minAge: 31, maxAge: 45, premiumAnnual: 350 },
    { minAge: 46, maxAge: 55, premiumAnnual: 500 },
    { minAge: 56, maxAge: 64, premiumAnnual: 700 },
  ],
}
const grid = { parameter: 'age', samplePoints: [25, 70], tiers: ['standard', 'optim'], levels: ['level_1', 'level_3'], includeAddonDelta: true }

describe('derivePricingExamples', () => {
  it('derives base and base+addon from the same calculateQuote arithmetic, labeled explicitly', () => {
    const ex = derivePricingExamples(tree, grid)
    const cell = ex.find((e) => e.age === 25 && e.tier === 'standard' && e.level === 'level_1')!
    expect(cell.base).toEqual({ premiumAnnual: 190, premiumMonthly: 15.83 })
    expect(cell.withAddon).toEqual({ premiumAnnual: 390, premiumMonthly: 32.5, addonDelta: 200 })
    expect(cell.currency).toBe('RON')
  })
  it('marks the addon ineligible when no age band matches — never a silent 0 (#9 folded fix)', () => {
    const ex = derivePricingExamples(tree, grid)
    const cell = ex.find((e) => e.age === 70 && e.tier === 'optim' && e.level === 'level_3')!
    expect(cell.base.premiumAnnual).toBe(430)
    expect(cell.withAddon).toEqual({ ineligible: true, reason: 'addon_age_band_unavailable' })
  })
  it('emits one example per (age x tier x level) grid cell', () => {
    expect(derivePricingExamples(tree, grid)).toHaveLength(8)
  })
  it('erratum 9: an unknown variation parameter yields NO examples — never guessed cells', () => {
    expect(derivePricingExamples(tree, { ...grid, parameter: 'smoker_status' })).toEqual([])
  })
})
