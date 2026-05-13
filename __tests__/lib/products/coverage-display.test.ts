import { describe, it, expect } from 'vitest'
import { collapseCoveragesForDisplay } from '@/lib/products/coverage-display'

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
