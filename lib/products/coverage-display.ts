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
