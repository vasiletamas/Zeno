/**
 * Coverage value formatting (T15) — shared by the quote card (client) and
 * node unit tests: pure, no React, no DB.
 *
 * Lump sums keep the historical quote-card formatting byte-identical
 * ("16.000 RON", "2M EUR"). Per-day coverages read as a daily indemnity
 * with every qualifier the catalog carries:
 *   "20 RON/zi (max 90 zile/an, franșiză 3 zile)"
 *   "100 EUR/day (max 60 days/event)"
 */
import type { CapPeriod, CoverageUnit } from '@/lib/products/coverage-display'

export interface FormattableCoverage {
  amount: number
  currency: string
  /** absent on legacy payload rows → lump_sum */
  unit?: CoverageUnit
  maxUnits?: number
  deductibleDays?: number
  /** defaults to per_year wording when a cap exists without a period */
  capPeriod?: CapPeriod
}

/** Moved verbatim from components/chat/rich/quote-card.tsx (T15). */
export function formatAmount(amount: number, currency: string): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M ${currency}`
  }
  return `${amount.toLocaleString('ro-RO')} ${currency}`
}

export function formatCoverage(cov: FormattableCoverage, lang: 'ro' | 'en'): string {
  if (cov.unit !== 'per_day') return formatAmount(cov.amount, cov.currency)

  const perDay = `${formatAmount(cov.amount, cov.currency)}/${lang === 'ro' ? 'zi' : 'day'}`
  const qualifiers: string[] = []
  if (cov.maxUnits != null) {
    const period =
      cov.capPeriod === 'per_event'
        ? lang === 'ro' ? 'eveniment' : 'event'
        : lang === 'ro' ? 'an' : 'year'
    qualifiers.push(
      lang === 'ro' ? `max ${cov.maxUnits} zile/${period}` : `max ${cov.maxUnits} days/${period}`,
    )
  }
  if (cov.deductibleDays != null) {
    qualifiers.push(
      lang === 'ro' ? `franșiză ${cov.deductibleDays} zile` : `${cov.deductibleDays}-day deductible`,
    )
  }
  return qualifiers.length > 0 ? `${perDay} (${qualifiers.join(', ')})` : perDay
}
