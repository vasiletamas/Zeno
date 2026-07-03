/**
 * shapeProductInfo — compact, customer-relevant projection of a raw product.
 *
 * get_product_info used to return the raw Prisma tree (~19K tokens): the full
 * sales playbook (coaching, already in the prompt), every scalar column,
 * timestamps/ids, and the coverageType object inlined on all 75 coverage rows
 * (only 7 distinct). This shapes it down to what the agent needs to talk to a
 * customer:
 *   - drops defaultPlaybook, ids, timestamps, isActive, insightKeys
 *   - dedups coverage types into a `coverageTypes` legend; coverage rows
 *     reference a type by code instead of inlining the whole object
 *   - when the customer's age is known, trims age-based coverages to the
 *     matching band (collapses dozens of rows to one)
 *
 * E1.7 (T11.D1/D3): every NUMBER the agent can utter pre-quote is
 * engine-derived (pricing_examples via calculateQuote, eligibility_bounds
 * via the rules projection) and every CLAIM is published authored content
 * (key_value_product_points / sell_specific_info / pricing_note; addons[]
 * fold sell_specific_addon_info — no separate addon-info tool). The legacy
 * authored surfaces (features / pricingExplanation / premiumRange /
 * targetAgeRange / raw eligibility passthrough) are GONE from the shape.
 *
 * Pure function — no DB, no caching concerns. The handler resolves age and
 * the derived inputs and calls this.
 */

import { parseEligibilityRuleSet } from '@/lib/engines/eligibility'
import type { EligibilityBounds } from '@/lib/engines/eligibility'
import type { PricingExample } from '@/lib/engines/pricing-examples'

interface LocalizedText {
  en: string
  ro: string
}

/** Published bilingual authored value (content is prose or a string list). */
export interface LocalizedContent {
  ro: unknown
  en: unknown
}

export interface DerivedProductInputs {
  pricingExamples: PricingExample[]
  eligibilityBounds: EligibilityBounds
  content: {
    keyValueProductPoints: LocalizedContent | null
    sellSpecificInfo: LocalizedContent | null
    pricingNote: LocalizedContent | null
    contentVersions: string[]
  }
  addonContent: Record<string, { sellSpecificAddonInfo: LocalizedContent | null }>
}

interface RawCoverageType {
  code: string
  name: LocalizedText
  description: LocalizedText
  category: string
  unit: string
  maxUnits: number | null
  deductibleDays: number | null
}

interface RawCoverageAmount {
  amount: number
  currency: string
  isAgeBased: boolean
  minAge: number | null
  maxAge: number | null
  coverageType?: RawCoverageType | null
}

interface RawLevel {
  code: string
  name: LocalizedText
  premiumAnnual: number
  currency: string
  coverageAmounts?: RawCoverageAmount[]
}

interface RawTier {
  code: string
  name: LocalizedText
  levels?: RawLevel[]
}

interface RawPricingRule {
  minAge: number
  maxAge: number
  premiumAnnual: number
  currency: string
}

interface RawAddon {
  code: string
  name: LocalizedText
  description: LocalizedText
  waitingPeriod: string | null
  pricingRules?: RawPricingRule[]
  coverageAmounts?: RawCoverageAmount[]
}

export interface RawProduct {
  code: string
  name: LocalizedText
  description: LocalizedText
  insuranceType: string
  subType?: string
  eligibility?: unknown
  exclusions?: unknown
  targetCustomer?: string
  contractTerm?: string
  gracePeriod?: string
  medicalExamRequired?: boolean
  territoryCoverage?: string
  paymentFrequencyOptions?: unknown
  quoteValidityDays?: number
  pricingTiers?: RawTier[]
  addons?: RawAddon[]
}

interface CoverageLegendEntry {
  name: LocalizedText
  description: LocalizedText
  category: string
  unit: string
  maxUnits: number | null
  deductibleDays: number | null
}

interface ShapedCoverage {
  coverage: string
  amount: number
  currency: string
  ageBand?: { minAge: number | null; maxAge: number | null }
}

interface ShapedLevel {
  code: string
  name: LocalizedText
  currency: string
  coverages: ShapedCoverage[]
}

interface ShapedPackage {
  code: string
  name: LocalizedText
  levels: ShapedLevel[]
}

interface ShapedAddon {
  code: string
  name: LocalizedText
  description: LocalizedText
  waitingPeriod: string | null
  coverages: ShapedCoverage[]
  sell_specific_addon_info?: LocalizedContent | null
}

export interface ShapedProduct {
  code: string
  name: LocalizedText
  description: LocalizedText
  insuranceType: string
  subType?: string
  exclusions?: unknown
  targetCustomer?: string
  contractTerm?: string
  gracePeriod?: string
  medicalExamRequired?: boolean
  territoryCoverage?: string
  paymentFrequencyOptions?: unknown
  quoteValidityDays?: number
  /** E1.7: engine-derived example premiums over the declared grid. */
  pricing_examples: PricingExample[]
  /** E1.7: bounds projected from the SAME rules the engine enforces. */
  eligibility_bounds: EligibilityBounds | null
  /** C2.3: authored eligibility prose (never evaluated, never numbers). */
  eligibility_narrative?: unknown
  /** E1.7: published authored claims — the ONLY selling-claim source. */
  key_value_product_points: LocalizedContent | null
  sell_specific_info: LocalizedContent | null
  pricing_note: LocalizedContent | null
  coverageTypes: Record<string, CoverageLegendEntry>
  packages: ShapedPackage[]
  addons: ShapedAddon[]
}

function ageInBand(age: number, minAge: number | null, maxAge: number | null): boolean {
  if (minAge != null && age < minAge) return false
  if (maxAge != null && age > maxAge) return false
  return true
}

/** The authored narrative prose from the typed ruleset — never bounds, never rules. */
function shapeNarrative(raw: unknown): unknown {
  try {
    return parseEligibilityRuleSet(raw).narrative
  } catch {
    return undefined
  }
}

function shapeCoverages(
  rows: RawCoverageAmount[] | undefined,
  age: number | undefined,
  legend: Record<string, CoverageLegendEntry>,
): ShapedCoverage[] {
  const out: ShapedCoverage[] = []
  for (const row of rows ?? []) {
    const ct = row.coverageType
    if (ct?.code && !legend[ct.code]) {
      legend[ct.code] = {
        name: ct.name,
        description: ct.description,
        category: ct.category,
        unit: ct.unit,
        maxUnits: ct.maxUnits ?? null,
        deductibleDays: ct.deductibleDays ?? null,
      }
    }
    const code = ct?.code ?? 'UNKNOWN'

    if (row.isAgeBased) {
      // Trim to the matching band when age is known; otherwise keep all bands annotated.
      if (age != null && !ageInBand(age, row.minAge, row.maxAge)) continue
      const entry: ShapedCoverage = { coverage: code, amount: row.amount, currency: row.currency }
      if (age == null) entry.ageBand = { minAge: row.minAge, maxAge: row.maxAge }
      out.push(entry)
    } else {
      out.push({ coverage: code, amount: row.amount, currency: row.currency })
    }
  }
  return out
}

const EMPTY_DERIVED: DerivedProductInputs = {
  pricingExamples: [],
  eligibilityBounds: { minAge: null, maxAge: null, otherRuleCodes: [] },
  content: { keyValueProductPoints: null, sellSpecificInfo: null, pricingNote: null, contentVersions: [] },
  addonContent: {},
}

export function shapeProductInfo(
  raw: RawProduct,
  opts: { age?: number; derived?: DerivedProductInputs } = {},
): ShapedProduct {
  const { age } = opts
  const derived = opts.derived ?? EMPTY_DERIVED
  const coverageTypes: Record<string, CoverageLegendEntry> = {}

  const packages: ShapedPackage[] = (raw.pricingTiers ?? []).map((tier) => ({
    code: tier.code,
    name: tier.name,
    levels: (tier.levels ?? []).map((level) => ({
      code: level.code,
      name: level.name,
      currency: level.currency,
      coverages: shapeCoverages(level.coverageAmounts, age, coverageTypes),
    })),
  }))

  const addons: ShapedAddon[] = (raw.addons ?? []).map((addon) => ({
    code: addon.code,
    name: addon.name,
    description: addon.description,
    waitingPeriod: addon.waitingPeriod ?? null,
    coverages: shapeCoverages(addon.coverageAmounts, age, coverageTypes),
    sell_specific_addon_info: derived.addonContent[addon.code]?.sellSpecificAddonInfo ?? null,
  }))

  return {
    code: raw.code,
    name: raw.name,
    description: raw.description,
    insuranceType: raw.insuranceType,
    subType: raw.subType,
    exclusions: raw.exclusions,
    targetCustomer: raw.targetCustomer,
    contractTerm: raw.contractTerm,
    gracePeriod: raw.gracePeriod,
    medicalExamRequired: raw.medicalExamRequired,
    territoryCoverage: raw.territoryCoverage,
    paymentFrequencyOptions: raw.paymentFrequencyOptions,
    quoteValidityDays: raw.quoteValidityDays,
    pricing_examples: derived.pricingExamples,
    eligibility_bounds: opts.derived ? derived.eligibilityBounds : null,
    eligibility_narrative: shapeNarrative(raw.eligibility),
    key_value_product_points: derived.content.keyValueProductPoints,
    sell_specific_info: derived.content.sellSpecificInfo,
    pricing_note: derived.content.pricingNote,
    coverageTypes,
    packages,
    addons,
  }
}
