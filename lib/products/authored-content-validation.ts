/**
 * Authored-content validation (E1.2, M6/T11.D2/T11.D5).
 *
 * Two gates the publish workflow runs over a version's rows:
 *  - locale completeness: every (field, addon) group ships ro AND en — the
 *    agent must never fall back to the wrong language mid-sale;
 *  - no numerals: authored selling claims carry NO raw digits. Amounts are
 *    referenced via {{coverage:CODE}} placeholders resolved at read time
 *    from the coverage rows the engine prices with — retyped numbers are
 *    exactly the presentation drift #9 kills.
 */
export type AuthoredLocale = 'ro' | 'en'
export interface AuthoredRow {
  field: string
  addonCode: string | null
  locale: AuthoredLocale
  content: unknown
}
export type ContentValidationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_locale' | 'numerals_in_authored_content'; params: Record<string, unknown> }

const PLACEHOLDER = /\{\{[^}]+\}\}/g

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(textOf).join(' ')
  if (content && typeof content === 'object') return Object.values(content).map(textOf).join(' ')
  return String(content ?? '')
}

export function validateContentSet(rows: AuthoredRow[]): ContentValidationResult {
  const groups = new Map<string, Set<AuthoredLocale>>()
  for (const row of rows) {
    const key = `${row.field}::${row.addonCode ?? ''}`
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key)!.add(row.locale)
  }
  for (const [group, locales] of groups) {
    for (const required of ['ro', 'en'] as const) {
      if (!locales.has(required)) return { ok: false, reason: 'missing_locale', params: { group, missing: required } }
    }
  }
  for (const row of rows) {
    if (/\d/.test(textOf(row.content).replace(PLACEHOLDER, ''))) {
      return { ok: false, reason: 'numerals_in_authored_content', params: { field: row.field, locale: row.locale } }
    }
  }
  return { ok: true }
}

export function resolveCoveragePlaceholders(
  text: string,
  coverage: Record<string, { amount: number; currency: string }>,
  locale: AuthoredLocale,
): string {
  return text.replace(/\{\{coverage:([A-Z0-9_]+)\}\}/g, (whole, code: string) => {
    const row = coverage[code]
    if (!row) return whole
    return `${row.amount.toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-US')} ${row.currency}`
  })
}
