import { describe, it, expect } from 'vitest'
import { capPeriodForCoverage, collapseCoveragesForDisplay, toQuoteCoverageRow } from '@/lib/products/coverage-display'

const DEATH = {
  code: 'DEATH_ANY_CAUSE',
  name: { en: 'Death (any cause)', ro: 'Deces din orice cauză' },
}
const ACCIDENT = {
  code: 'PERMANENT_INVALIDITY_ACCIDENT',
  name: { en: 'Permanent invalidity', ro: 'Invaliditate permanentă' },
}

function row(amount: number, opts: { minAge?: number; maxAge?: number; type?: typeof DEATH } = {}) {
  return {
    amount,
    currency: 'RON',
    isAgeBased: opts.minAge !== undefined || opts.maxAge !== undefined,
    minAge: opts.minAge ?? null,
    maxAge: opts.maxAge ?? null,
    coverageType: opts.type ?? DEATH,
  }
}

describe('collapseCoveragesForDisplay', () => {
  it('passes through non-age-banded coverages unchanged', () => {
    const result = collapseCoveragesForDisplay([
      { amount: 10000, currency: 'RON', isAgeBased: false, minAge: null, maxAge: null, coverageType: ACCIDENT },
    ])
    expect(result).toEqual([
      { name: ACCIDENT.name, amount: 10000, currency: 'RON' },
    ])
  })

  it('with known age, picks the matching age-banded row only', () => {
    const result = collapseCoveragesForDisplay(
      [
        row(40000, { minAge: 18, maxAge: 25 }),
        row(30000, { minAge: 26, maxAge: 30 }),
        row(22000, { minAge: 31, maxAge: 35 }),
      ],
      32,
    )
    expect(result).toEqual([
      { name: DEATH.name, amount: 22000, currency: 'RON' },
    ])
  })

  it('with unknown age, collapses age-banded rows of same type into one entry with amountRange', () => {
    const result = collapseCoveragesForDisplay([
      row(40000, { minAge: 18, maxAge: 25 }),
      row(30000, { minAge: 26, maxAge: 30 }),
      row(22000, { minAge: 31, maxAge: 35 }),
      row(2000, { minAge: 61, maxAge: 64 }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: DEATH.name,
      currency: 'RON',
      amountRange: { min: 2000, max: 40000 },
    })
  })

  it('groups age-banded rows by coverage type, keeping different types separate', () => {
    const result = collapseCoveragesForDisplay([
      row(40000, { minAge: 18, maxAge: 25 }),
      row(30000, { minAge: 26, maxAge: 30 }),
      row(10000, { type: ACCIDENT }),
    ])
    expect(result).toHaveLength(2)
    const death = result.find((c) => c.name.ro === DEATH.name.ro)
    const accident = result.find((c) => c.name.ro === ACCIDENT.name.ro)
    expect(death).toMatchObject({ amountRange: { min: 30000, max: 40000 } })
    expect(accident).toMatchObject({ amount: 10000 })
    expect(accident).not.toHaveProperty('amountRange')
  })

  it('with known age but no matching band, falls back to widest range', () => {
    const result = collapseCoveragesForDisplay(
      [
        row(40000, { minAge: 18, maxAge: 25 }),
        row(30000, { minAge: 26, maxAge: 30 }),
      ],
      80, // outside all bands
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      amountRange: { min: 30000, max: 40000 },
    })
  })
})

/**
 * T15: CoverageType has no capPeriod column — the period a maxUnits cap
 * applies to lives only in seed prose ("Maxim: 90 zile pe an" vs "Per
 * eveniment"), so it is encoded by coverage code with a per_year default.
 */
describe('capPeriodForCoverage', () => {
  it('HOSPITALIZATION_ABROAD caps per event (seed description: "Per eveniment")', () => {
    expect(capPeriodForCoverage('HOSPITALIZATION_ABROAD')).toBe('per_event')
  })

  it('defaults to per_year for every other code (HOSPITALIZATION_ACCIDENT: "Maxim: 90 zile pe an")', () => {
    expect(capPeriodForCoverage('HOSPITALIZATION_ACCIDENT')).toBe('per_year')
    expect(capPeriodForCoverage('SOME_FUTURE_COVERAGE')).toBe('per_year')
  })
})

describe('toQuoteCoverageRow', () => {
  const name = { en: 'x', ro: 'x' }

  it('HOSPITALIZATION_ACCIDENT seed shape: per_day row carries maxUnits, deductibleDays and capPeriod', () => {
    const row = toQuoteCoverageRow({
      amount: 20,
      currency: 'RON',
      coverageType: { code: 'HOSPITALIZATION_ACCIDENT', name, unit: 'per_day', maxUnits: 90, deductibleDays: 3 },
    })
    expect(row).toEqual({
      code: 'HOSPITALIZATION_ACCIDENT',
      name,
      amount: 20,
      currency: 'RON',
      unit: 'per_day',
      maxUnits: 90,
      deductibleDays: 3,
      capPeriod: 'per_year',
    })
  })

  it('HOSPITALIZATION_ABROAD seed shape: per_day + per_event cap, NO deductibleDays key', () => {
    const row = toQuoteCoverageRow({
      amount: 100,
      currency: 'EUR',
      coverageType: { code: 'HOSPITALIZATION_ABROAD', name, unit: 'per_day', maxUnits: 60, deductibleDays: null },
    })
    expect(row).toEqual({
      code: 'HOSPITALIZATION_ABROAD',
      name,
      amount: 100,
      currency: 'EUR',
      unit: 'per_day',
      maxUnits: 60,
      capPeriod: 'per_event',
    })
    expect(row).not.toHaveProperty('deductibleDays')
  })

  it('lump_sum rows carry NO qualifier keys at all', () => {
    const row = toQuoteCoverageRow({
      amount: 16000,
      currency: 'RON',
      coverageType: { code: 'DEATH_ANY_CAUSE', name, unit: 'lump_sum', maxUnits: null, deductibleDays: null },
    })
    expect(row).toEqual({ code: 'DEATH_ANY_CAUSE', name, amount: 16000, currency: 'RON', unit: 'lump_sum' })
    expect(row).not.toHaveProperty('maxUnits')
    expect(row).not.toHaveProperty('capPeriod')
  })

  it('a null/unknown unit defaults to lump_sum', () => {
    const row = toQuoteCoverageRow({
      amount: 4000,
      currency: 'RON',
      coverageType: { code: 'SURGICAL_INTERVENTION_ACCIDENT', name, unit: null, maxUnits: null, deductibleDays: null },
    })
    expect(row.unit).toBe('lump_sum')
  })

  it('per_day without maxUnits carries no capPeriod (nothing to qualify)', () => {
    const row = toQuoteCoverageRow({
      amount: 20,
      currency: 'RON',
      coverageType: { code: 'HOSPITALIZATION_ACCIDENT', name, unit: 'per_day', maxUnits: null, deductibleDays: 3 },
    })
    expect(row).not.toHaveProperty('maxUnits')
    expect(row).not.toHaveProperty('capPeriod')
    expect(row.deductibleDays).toBe(3)
  })
})
