/**
 * Pure synchronous candidate inference: given a message + optional interests +
 * the active catalog, return a unique product match or null.
 *
 * Message keywords take precedence over interests (a fresh explicit intent
 * beats stale stored signals). Returns confidence=70 because keyword match
 * is decent but not as strong as an explicit set_candidate_product call.
 *
 * See docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
 */

export interface CandidateCatalogEntry {
  id: string
  insuranceType: string
}

export interface CandidateInferenceResult {
  productId: string
  confidence: number
}

/**
 * Maps category keywords (case- and diacritic-insensitive) to insuranceType.
 *
 * Uses Unicode-aware boundaries: `(?<!\p{L})...(?!\p{L})` instead of `\b`,
 * because JS `\b` treats Romanian letters like `ă`/`ț` as non-word characters,
 * which breaks matching for words like "viață" (the implicit boundary inside
 * the word would falsely match, and the trailing boundary would fail).
 */
const CATEGORY_KEYWORDS: Array<{ pattern: RegExp; insuranceType: string }> = [
  { pattern: /(?<!\p{L})(via[țt][ăa]|life)(?!\p{L})/iu, insuranceType: 'LIFE' },
  { pattern: /(?<!\p{L})(locuin[țt][ăa]|home|house|casa)(?!\p{L})/iu, insuranceType: 'HOME' },
  { pattern: /(?<!\p{L})(masina|car|auto|vehicul)(?!\p{L})/iu, insuranceType: 'AUTO' },
  { pattern: /(?<!\p{L})(sanatate|s[ăa]n[ăa]tate|health|medical)(?!\p{L})/iu, insuranceType: 'HEALTH' },
  { pattern: /(?<!\p{L})(travel|c[ăa]l[ăa]torie|voiaj)(?!\p{L})/iu, insuranceType: 'TRAVEL' },
]

function findInsuranceTypeInText(text: string): string | null {
  for (const { pattern, insuranceType } of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return insuranceType
  }
  return null
}

function findInsuranceTypeInInterests(interests: string[]): string | null {
  for (const interest of interests) {
    const t = findInsuranceTypeInText(interest)
    if (t) return t
  }
  return null
}

export function inferCandidate(
  message: string,
  interests: string[] | null,
  catalog: CandidateCatalogEntry[],
): CandidateInferenceResult | null {
  // Message takes precedence
  let insuranceType = findInsuranceTypeInText(message)
  if (!insuranceType && interests && interests.length > 0) {
    insuranceType = findInsuranceTypeInInterests(interests)
  }
  if (!insuranceType) return null

  const matches = catalog.filter((p) => p.insuranceType === insuranceType)
  if (matches.length !== 1) return null

  return { productId: matches[0].id, confidence: 70 }
}

/**
 * Cheap pre-check: returns true if the message OR interests mention any
 * known category keyword. Used by the orchestrator to short-circuit the
 * catalog DB query when no keyword is present in the turn at all.
 *
 * Pure, in-memory regex check. Safe to call on every turn.
 */
export function hasAnyCategoryKeyword(
  message: string,
  interests: string[] | null,
): boolean {
  if (findInsuranceTypeInText(message) !== null) return true
  if (interests && interests.length > 0 && findInsuranceTypeInInterests(interests) !== null) return true
  return false
}
