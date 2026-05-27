import { describe, it, expect } from 'vitest'
import { shapeProductInfo, type RawProduct } from '@/lib/tools/shape-product-info'

const DEATH = {
  id: 'ct1', code: 'DEATH_ANY_CAUSE',
  name: { ro: 'Deces din orice cauză', en: 'Death from any cause' },
  description: { ro: 'desc ro', en: 'Financial protection for heirs' },
  category: 'life', unit: 'lump_sum', maxUnits: null, deductibleDays: null,
  createdAt: new Date(),
}
const INVALIDITY = {
  id: 'ct2', code: 'PERMANENT_INVALIDITY_ACCIDENT',
  name: { ro: 'Invaliditate', en: 'Permanent invalidity' },
  description: { ro: 'd', en: 'd' },
  category: 'accident', unit: 'lump_sum', maxUnits: null, deductibleDays: null,
  createdAt: new Date(),
}
const TREATMENT = {
  id: 'ct3', code: 'TREATMENT_COSTS',
  name: { ro: 'Tratament', en: 'Treatment costs' },
  description: { ro: 'd', en: 'd' },
  category: 'health', unit: 'lump_sum', maxUnits: null, deductibleDays: null,
  createdAt: new Date(),
}

function ca(over: Record<string, unknown>) {
  return {
    id: 'x', coverageTypeId: 'y', pricingLevelId: 'l1', addonId: null,
    currency: 'RON', isAgeBased: false, minAge: null, maxAge: null,
    createdAt: new Date(),
    ...over,
  }
}

const RAW = {
  id: 'p1', code: 'protect', insuranceType: 'LIFE', subType: 'term_life',
  name: { ro: 'Protect', en: 'Protect' },
  description: { ro: 'Asigurare de viață', en: 'Term life' },
  defaultPlaybook: 'HUGE PLAYBOOK '.repeat(800), // ~10KB of coaching that must be dropped
  pricingExplanation: 'Standard I=190 …',
  premiumRange: { min: 190, max: 430, currency: 'RON', frequency: 'annual' },
  eligibility: { minAge: 18, maxAge: 64, residency: 'Romania' },
  features: ['Two packages'], exclusions: ['See conditions'],
  targetCustomer: 'young', contractTerm: '1y', gracePeriod: '60 days',
  medicalExamRequired: false, territoryCoverage: 'Worldwide',
  paymentFrequencyOptions: { annual: { multiplier: 1 } }, quoteValidityDays: 30,
  isActive: true, createdAt: new Date(), updatedAt: new Date(),
  pricingTiers: [
    {
      id: 't1', productId: 'p1', code: 'standard', name: { ro: 'Standard', en: 'Standard' },
      orderIndex: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(),
      levels: [
        {
          id: 'l1', tierId: 't1', code: 'level_1', name: { ro: 'Nivelul I', en: 'Level I' },
          premiumAnnual: 190, currency: 'RON', orderIndex: 0, isActive: true,
          createdAt: new Date(), updatedAt: new Date(),
          coverageAmounts: [
            ca({ amount: 40000, isAgeBased: true, minAge: 18, maxAge: 25, coverageType: DEATH }),
            ca({ amount: 29000, isAgeBased: true, minAge: 36, maxAge: 40, coverageType: DEATH }),
            ca({ amount: 10000, isAgeBased: true, minAge: 41, maxAge: 45, coverageType: DEATH }),
            ca({ amount: 10000, isAgeBased: false, coverageType: INVALIDITY }),
          ],
        },
      ],
    },
  ],
  addons: [
    {
      id: 'a1', productId: 'p1', code: 'TREATMENT_ABROAD_BD',
      name: { ro: 'Tratament', en: 'Treatment abroad' }, description: { ro: 'd', en: 'd' },
      waitingPeriod: '180 days', isActive: true, createdAt: new Date(), updatedAt: new Date(),
      pricingRules: [
        { id: 'pr1', addonId: 'a1', minAge: 18, maxAge: 30, premiumAnnual: 200, currency: 'RON' },
        { id: 'pr2', addonId: 'a1', minAge: 31, maxAge: 45, premiumAnnual: 350, currency: 'RON' },
      ],
      coverageAmounts: [
        ca({ amount: 2000000, currency: 'EUR', addonId: 'a1', coverageType: TREATMENT }),
      ],
    },
  ],
}

// RAW is intentionally a DB-shaped superset (ids, timestamps, inlined
// coverageType) — exactly what the handler passes in. Cast mirrors the handler.
const raw = RAW as unknown as RawProduct

describe('shapeProductInfo', () => {
  it('drops the coaching playbook and internal/raw fields', () => {
    const out = shapeProductInfo(raw)
    const json = JSON.stringify(out)
    expect(json).not.toContain('PLAYBOOK')
    expect(json).not.toContain('defaultPlaybook')
    expect(json).not.toContain('createdAt')
    expect(json).not.toContain('pricingLevelId')
    expect((out as unknown as Record<string, unknown>).id).toBeUndefined()
    // keeps customer-relevant scalars
    expect(out.code).toBe('protect')
    expect(out.pricingExplanation).toBe('Standard I=190 …')
    expect(out.eligibility).toEqual({ minAge: 18, maxAge: 64, residency: 'Romania' })
  })

  it('dedups coverage types into a legend; coverage rows reference by code (not inlined)', () => {
    const out = shapeProductInfo(raw)
    expect(Object.keys(out.coverageTypes).sort()).toEqual([
      'DEATH_ANY_CAUSE', 'PERMANENT_INVALIDITY_ACCIDENT', 'TREATMENT_COSTS',
    ])
    const cov = out.packages[0].levels[0].coverages[0]
    expect(cov.coverage).toBeDefined()
    expect((cov as unknown as Record<string, unknown>).coverageType).toBeUndefined()
    // legend entry carries the description once
    expect(out.coverageTypes.DEATH_ANY_CAUSE.category).toBe('life')
  })

  it('keeps all premiums and amounts', () => {
    const out = shapeProductInfo(raw)
    expect(out.packages[0].levels[0].premiumAnnual).toBe(190)
    const amounts = out.packages[0].levels[0].coverages.map((c) => c.amount).sort((a, b) => a - b)
    expect(amounts).toEqual([10000, 10000, 29000, 40000])
  })

  it('without age, keeps all age bands (with ageBand annotations)', () => {
    const out = shapeProductInfo(raw)
    const death = out.packages[0].levels[0].coverages.filter((c) => c.coverage === 'DEATH_ANY_CAUSE')
    expect(death).toHaveLength(3)
    expect(death.every((c) => c.ageBand != null)).toBe(true)
  })

  it('with age, trims age-based coverages to the matching band only', () => {
    const out = shapeProductInfo(raw, { age: 39 })
    const death = out.packages[0].levels[0].coverages.filter((c) => c.coverage === 'DEATH_ANY_CAUSE')
    expect(death).toHaveLength(1)
    expect(death[0].amount).toBe(29000) // the 36–40 band
    // non-age-based coverage is always kept
    const inval = out.packages[0].levels[0].coverages.filter((c) => c.coverage === 'PERMANENT_INVALIDITY_ACCIDENT')
    expect(inval).toHaveLength(1)
  })

  it('with age, trims the addon premium to the matching band', () => {
    const out = shapeProductInfo(raw, { age: 39 })
    expect(out.addons[0].premiums).toHaveLength(1)
    expect(out.addons[0].premiums[0].premiumAnnual).toBe(350) // the 31–45 band
    expect(out.addons[0].coverages[0].amount).toBe(2000000)
  })

  it('produces a dramatically smaller payload than the raw object', () => {
    const out = shapeProductInfo(raw, { age: 39 })
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(RAW).length * 0.4)
  })
})
