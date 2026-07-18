import { describe, it, expect } from 'vitest'
import { derivePricingExamples, pricingTreeNeedsFx } from '@/lib/engines/pricing-examples'

// literals mirror prisma/seeds/seed-product.ts pricing rows — T17: the addon
// rate card is denominated in EUR (its true denomination); the RON premiums
// come out of T18's conversion through the FX reference (default fixed 5.06)
const tree = {
  quoteValidityDays: 30,
  tiers: [
    { code: 'standard', name: { en: 'Standard', ro: 'Standard' }, levels: [
      { code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premiumAnnual: 190, currency: 'RON' },
      { code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premiumAnnual: 390, currency: 'RON' },
    ] },
    { code: 'optim', name: { en: 'Optim', ro: 'Optim' }, levels: [
      { code: 'level_1', name: { en: 'Level I', ro: 'Nivelul I' }, premiumAnnual: 230, currency: 'RON' },
      { code: 'level_3', name: { en: 'Level III', ro: 'Nivelul III' }, premiumAnnual: 430, currency: 'RON' },
    ] },
  ],
  addonRules: [
    { minAge: 18, maxAge: 30, premiumAnnual: 200, currency: 'EUR' },
    { minAge: 31, maxAge: 45, premiumAnnual: 350, currency: 'EUR' },
    { minAge: 46, maxAge: 55, premiumAnnual: 500, currency: 'EUR' },
    { minAge: 56, maxAge: 64, premiumAnnual: 700, currency: 'EUR' },
  ],
}
const grid = { parameter: 'age', samplePoints: [25, 70], tiers: ['standard', 'optim'], levels: ['level_1', 'level_3'], includeAddonDelta: true }
const fx = { rate: 5.06, date: '2026-07-17', source: 'fixed:env' }

describe('derivePricingExamples', () => {
  it('derives base and base+addon from the same calculateQuote arithmetic, labeled explicitly', () => {
    const ex = derivePricingExamples(tree, grid, fx)
    const cell = ex.find((e) => e.age === 25 && e.tier === 'standard' && e.level === 'level_1')!
    expect(cell.base).toEqual({ premiumAnnual: 190, premiumMonthly: 15.83 })
    // 200 EUR * 5.06 = 1012 RON delta → 190 + 1012 = 1202
    expect(cell.withAddon).toEqual({ premiumAnnual: 1202, premiumMonthly: 100.17, addonDelta: 1012 })
    expect(cell.currency).toBe('RON')
  })
  it('marks the addon ineligible when no age band matches — never a silent 0 (#9 folded fix)', () => {
    const ex = derivePricingExamples(tree, grid, fx)
    const cell = ex.find((e) => e.age === 70 && e.tier === 'optim' && e.level === 'level_3')!
    expect(cell.base.premiumAnnual).toBe(430)
    expect(cell.withAddon).toEqual({ ineligible: true, reason: 'addon_age_band_unavailable' })
  })
  it('emits one example per (age x tier x level) grid cell', () => {
    expect(derivePricingExamples(tree, grid, fx)).toHaveLength(8)
  })
  it('erratum 9: an unknown variation parameter yields NO examples — never guessed cells', () => {
    expect(derivePricingExamples(tree, { ...grid, parameter: 'smoker_status' }, fx)).toEqual([])
  })

  // ── T18 (P4.2): the fx plumbing itself ────────────────────────────────────

  describe('T18: fx threading + mixed-denomination detection', () => {
    it('pricingTreeNeedsFx detects the mixed tree; a currency-less legacy tree never needs fx', () => {
      expect(pricingTreeNeedsFx(tree)).toBe(true)
      const legacyTree = {
        ...tree,
        tiers: tree.tiers.map((t) => ({ ...t, levels: t.levels.map(({ currency: _c, ...l }) => l) })),
        addonRules: tree.addonRules.map(({ currency: _c, ...r }) => r),
      }
      expect(pricingTreeNeedsFx(legacyTree)).toBe(false)
    })

    it('a same-currency tree ignores fx: unchanged math, naked-sum deltas', () => {
      const ronTree = { ...tree, addonRules: tree.addonRules.map((r) => ({ ...r, currency: 'RON' })) }
      const ex = derivePricingExamples(ronTree, grid, fx)
      const cell = ex.find((e) => e.age === 25 && e.tier === 'standard' && e.level === 'level_1')!
      expect(cell.withAddon).toEqual({ premiumAnnual: 390, premiumMonthly: 32.5, addonDelta: 200 })
      expect(pricingTreeNeedsFx(ronTree)).toBe(false)
    })

    it('base-only cells never touch fx; deriving base cells works without any fx at all', () => {
      const ex = derivePricingExamples(tree, { ...grid, includeAddonDelta: false }, null)
      const cell = ex.find((e) => e.age === 25 && e.tier === 'standard' && e.level === 'level_1')!
      expect(cell.base.premiumAnnual).toBe(190)
      expect(cell.withAddon).toBeNull()
    })
  })
})
