import { describe, it, expect } from 'vitest'
import { formatAmount, formatCoverage } from '@/lib/products/coverage-format'

/**
 * T15: the offer card carries ALL the numbers. Per-day coverages read as a
 * daily indemnity with their caps and franchise; lump sums keep the
 * historical quote-card formatting byte-identical ("16.000 RON", "2M EUR").
 * Shapes below mirror prisma/seeds/seed-product.ts exactly.
 */

describe('formatAmount (moved from quote-card — byte-identical regression)', () => {
  it('formats small amounts without grouping', () => {
    expect(formatAmount(20, 'RON')).toBe('20 RON')
  })

  it('formats thousands with the ro-RO locale exactly as the card did', () => {
    expect(formatAmount(16000, 'RON')).toBe(`${(16000).toLocaleString('ro-RO')} RON`)
    expect(formatAmount(50000, 'EUR')).toBe(`${(50000).toLocaleString('ro-RO')} EUR`)
  })

  it('formats whole millions as NM', () => {
    expect(formatAmount(2_000_000, 'EUR')).toBe('2M EUR')
  })

  it('formats fractional millions with one decimal', () => {
    expect(formatAmount(1_500_000, 'EUR')).toBe('1.5M EUR')
  })
})

describe('formatCoverage', () => {
  it('lump_sum: current formatting, both languages identical', () => {
    const cov = { amount: 16000, currency: 'RON', unit: 'lump_sum' as const }
    expect(formatCoverage(cov, 'ro')).toBe(`${(16000).toLocaleString('ro-RO')} RON`)
    expect(formatCoverage(cov, 'en')).toBe(`${(16000).toLocaleString('ro-RO')} RON`)
  })

  it('missing unit defaults to lump_sum (legacy payload rows keep rendering)', () => {
    expect(formatCoverage({ amount: 2_000_000, currency: 'EUR' }, 'ro')).toBe('2M EUR')
  })

  it('HOSPITALIZATION_ACCIDENT seed shape: per-day + yearly cap + franchise (ro)', () => {
    const cov = { amount: 20, currency: 'RON', unit: 'per_day' as const, maxUnits: 90, deductibleDays: 3, capPeriod: 'per_year' as const }
    expect(formatCoverage(cov, 'ro')).toBe('20 RON/zi (max 90 zile/an, franșiză 3 zile)')
  })

  it('HOSPITALIZATION_ACCIDENT seed shape: per-day + yearly cap + deductible (en)', () => {
    const cov = { amount: 20, currency: 'RON', unit: 'per_day' as const, maxUnits: 90, deductibleDays: 3, capPeriod: 'per_year' as const }
    expect(formatCoverage(cov, 'en')).toBe('20 RON/day (max 90 days/year, 3-day deductible)')
  })

  it('HOSPITALIZATION_ABROAD seed shape: per-day + per-event cap, no franchise (ro)', () => {
    const cov = { amount: 100, currency: 'EUR', unit: 'per_day' as const, maxUnits: 60, capPeriod: 'per_event' as const }
    expect(formatCoverage(cov, 'ro')).toBe('100 EUR/zi (max 60 zile/eveniment)')
  })

  it('HOSPITALIZATION_ABROAD seed shape: per-day + per-event cap, no deductible (en)', () => {
    const cov = { amount: 100, currency: 'EUR', unit: 'per_day' as const, maxUnits: 60, capPeriod: 'per_event' as const }
    expect(formatCoverage(cov, 'en')).toBe('100 EUR/day (max 60 days/event)')
  })

  it('per-day with no caps at all renders bare', () => {
    const cov = { amount: 20, currency: 'RON', unit: 'per_day' as const }
    expect(formatCoverage(cov, 'ro')).toBe('20 RON/zi')
    expect(formatCoverage(cov, 'en')).toBe('20 RON/day')
  })

  it('per-day with only a deductible renders just the franchise qualifier', () => {
    const cov = { amount: 20, currency: 'RON', unit: 'per_day' as const, deductibleDays: 3 }
    expect(formatCoverage(cov, 'ro')).toBe('20 RON/zi (franșiză 3 zile)')
    expect(formatCoverage(cov, 'en')).toBe('20 RON/day (3-day deductible)')
  })

  it('per-day with maxUnits but no capPeriod defaults the period to per-year wording', () => {
    const cov = { amount: 30, currency: 'RON', unit: 'per_day' as const, maxUnits: 90 }
    expect(formatCoverage(cov, 'ro')).toBe('30 RON/zi (max 90 zile/an)')
    expect(formatCoverage(cov, 'en')).toBe('30 RON/day (max 90 days/year)')
  })
})
