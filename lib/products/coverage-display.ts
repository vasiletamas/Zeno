/**
 * Coverage display helper
 *
 * Collapses raw CoverageAmount rows into entries suitable for the chat
 * product-card UI. When the customer's age is known, age-banded coverages
 * are filtered to the matching band. When age is unknown, all bands for the
 * same coverage type are collapsed into a single entry with an amountRange,
 * so the card shows "X — Y RON, în funcție de vârstă" rather than 9
 * identical "Deces din orice cauză: …" rows.
 */

interface LocalizedString {
  en: string
  ro: string
}

export interface RawCoverageRow {
  amount: number
  currency: string
  isAgeBased: boolean
  minAge: number | null
  maxAge: number | null
  coverageType: {
    code: string
    name: LocalizedString
  }
}

export interface DisplayCoverage {
  name: LocalizedString
  amount: number
  currency: string
  amountRange?: { min: number; max: number }
}

// ─────────────────────────────────────────────────────────────────────────
// T15: quote-card coverage rows — every number the seed carries
// ─────────────────────────────────────────────────────────────────────────

export type CoverageUnit = 'per_day' | 'lump_sum'
export type CapPeriod = 'per_year' | 'per_event'

/**
 * CoverageType has no capPeriod column — the period a maxUnits cap applies
 * to lives only in the seed's prose descriptions. Encode it by coverage
 * code: HOSPITALIZATION_ABROAD's 60 days are "Per eveniment"; everything
 * else (HOSPITALIZATION_ACCIDENT: "Maxim: 90 zile pe an de asigurare")
 * defaults to per insurance YEAR.
 */
const CAP_PERIOD_BY_COVERAGE_CODE: Record<string, CapPeriod> = {
  HOSPITALIZATION_ABROAD: 'per_event',
}

export function capPeriodForCoverage(code: string): CapPeriod {
  return CAP_PERIOD_BY_COVERAGE_CODE[code] ?? 'per_year'
}

/**
 * One coverage line of a quote (payload + persisted quote.coverages JSON).
 * Qualifier keys exist only when meaningful: per_day rows carry their cap
 * (maxUnits + capPeriod) and franchise (deductibleDays) when the catalog
 * defines them; lump sums carry none.
 */
export interface QuoteCoverageRow {
  code: string
  name: LocalizedString
  amount: number
  currency: string
  unit: CoverageUnit
  maxUnits?: number
  deductibleDays?: number
  capPeriod?: CapPeriod
}

/**
 * Map a CoverageAmount row (with its CoverageType included) to the quote
 * coverage line. "Spitalizare: 20 RON" was a 20 RON/DAY coverage with a
 * 90-day/year cap and a 3-day franchise — this is where those qualifiers
 * stop being dropped.
 */
export function toQuoteCoverageRow(ca: {
  amount: number
  currency: string
  coverageType: {
    code: string
    name: LocalizedString
    unit?: string | null
    maxUnits?: number | null
    deductibleDays?: number | null
  }
}): QuoteCoverageRow {
  const ct = ca.coverageType
  const unit: CoverageUnit = ct.unit === 'per_day' ? 'per_day' : 'lump_sum'
  const row: QuoteCoverageRow = {
    code: ct.code,
    name: ct.name,
    amount: ca.amount,
    currency: ca.currency,
    unit,
  }
  if (unit === 'per_day') {
    if (ct.maxUnits != null) {
      row.maxUnits = ct.maxUnits
      row.capPeriod = capPeriodForCoverage(ct.code)
    }
    if (ct.deductibleDays != null) row.deductibleDays = ct.deductibleDays
  }
  return row
}

function inBand(row: RawCoverageRow, age: number): boolean {
  return (
    (row.minAge === null || age >= row.minAge) &&
    (row.maxAge === null || age <= row.maxAge)
  )
}

export function collapseCoveragesForDisplay(
  rows: RawCoverageRow[],
  customerAge?: number,
): DisplayCoverage[] {
  const nonAgeBased = rows.filter((r) => !r.isAgeBased)
  const ageBased = rows.filter((r) => r.isAgeBased)

  const result: DisplayCoverage[] = nonAgeBased.map((r) => ({
    name: r.coverageType.name,
    amount: r.amount,
    currency: r.currency,
  }))

  // Group age-banded rows by coverage type code
  const grouped = new Map<string, RawCoverageRow[]>()
  for (const row of ageBased) {
    const key = row.coverageType.code
    const list = grouped.get(key) ?? []
    list.push(row)
    grouped.set(key, list)
  }

  for (const groupRows of grouped.values()) {
    const matched =
      customerAge !== undefined
        ? groupRows.find((r) => inBand(r, customerAge))
        : undefined

    if (matched) {
      result.push({
        name: matched.coverageType.name,
        amount: matched.amount,
        currency: matched.currency,
      })
    } else {
      const amounts = groupRows.map((r) => r.amount)
      const min = Math.min(...amounts)
      const max = Math.max(...amounts)
      result.push({
        name: groupRows[0].coverageType.name,
        amount: max,
        currency: groupRows[0].currency,
        amountRange: { min, max },
      })
    }
  }

  return result
}
