/**
 * Maps customer-friendly terms (en/ro, with/without diacritics) to product codes /
 * insurance types, so product lookup tolerates synonyms. Extend ALIASES freely.
 */
export function stripDiacritics(input: string): string {
  if (typeof input !== 'string') return ''
  // NFD decomposes accented letters into base + combining mark; stripping the
  // combining range (U+0300–U+036F) covers BOTH Romanian encodings: comma-below
  // (ș U+0219, ț U+021B) and the legacy cedilla forms (ş U+015F, ţ U+0163).
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export interface AliasLookupResult { productCode: string; insuranceType: string }

const ALIASES: Record<string, AliasLookupResult> = {
  // Life — the only seeded product (code 'protect', insuranceType LIFE).
  life: { productCode: 'protect', insuranceType: 'life' },
  viata: { productCode: 'protect', insuranceType: 'life' },
  protectie: { productCode: 'protect', insuranceType: 'life' },
  protect: { productCode: 'protect', insuranceType: 'life' },
  // Forward-looking placeholders: no such product is seeded yet, so these resolve to
  // null today. A genuine miss is handled upstream (Plan B: list available products).
  home: { productCode: 'property', insuranceType: 'property' },
  property: { productCode: 'property', insuranceType: 'property' },
  casa: { productCode: 'property', insuranceType: 'property' },
  locuinta: { productCode: 'property', insuranceType: 'property' },
  household: { productCode: 'property', insuranceType: 'property' },
  auto: { productCode: 'auto', insuranceType: 'auto' },
  car: { productCode: 'auto', insuranceType: 'auto' },
  masina: { productCode: 'auto', insuranceType: 'auto' },
  vehicul: { productCode: 'auto', insuranceType: 'auto' },
  health: { productCode: 'health', insuranceType: 'health' },
  sanatate: { productCode: 'health', insuranceType: 'health' },
  medical: { productCode: 'health', insuranceType: 'health' },
}

export function lookupAlias(customerInput: string): AliasLookupResult | null {
  if (typeof customerInput !== 'string' || customerInput.trim().length === 0) return null
  return ALIASES[stripDiacritics(customerInput.trim().toLowerCase())] ?? null
}
