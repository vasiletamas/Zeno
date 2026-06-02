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
 * Pure function — no DB, no caching concerns. The handler resolves age and
 * calls this.
 */

interface LocalizedText {
  en: string
  ro: string
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
  features?: unknown
  exclusions?: unknown
  pricingExplanation?: string
  targetCustomer?: string
  targetAgeRange?: string
  contractTerm?: string
  gracePeriod?: string
  medicalExamRequired?: boolean
  territoryCoverage?: string
  premiumRange?: unknown
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
}

export interface ShapedProduct {
  code: string
  name: LocalizedText
  description: LocalizedText
  insuranceType: string
  subType?: string
  eligibility?: unknown
  features?: unknown
  exclusions?: unknown
  pricingExplanation?: string
  targetCustomer?: string
  targetAgeRange?: string
  contractTerm?: string
  gracePeriod?: string
  medicalExamRequired?: boolean
  territoryCoverage?: string
  premiumRange?: unknown
  paymentFrequencyOptions?: unknown
  quoteValidityDays?: number
  coverageTypes: Record<string, CoverageLegendEntry>
  packages: ShapedPackage[]
  addons: ShapedAddon[]
}

function ageInBand(age: number, minAge: number | null, maxAge: number | null): boolean {
  if (minAge != null && age < minAge) return false
  if (maxAge != null && age > maxAge) return false
  return true
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

export function shapeProductInfo(
  raw: RawProduct,
  opts: { age?: number } = {},
): ShapedProduct {
  const { age } = opts
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
  }))

  return {
    code: raw.code,
    name: raw.name,
    description: raw.description,
    insuranceType: raw.insuranceType,
    subType: raw.subType,
    eligibility: raw.eligibility,
    features: raw.features,
    exclusions: raw.exclusions,
    pricingExplanation: raw.pricingExplanation,
    targetCustomer: raw.targetCustomer,
    targetAgeRange: raw.targetAgeRange,
    contractTerm: raw.contractTerm,
    gracePeriod: raw.gracePeriod,
    medicalExamRequired: raw.medicalExamRequired,
    territoryCoverage: raw.territoryCoverage,
    premiumRange: raw.premiumRange,
    paymentFrequencyOptions: raw.paymentFrequencyOptions,
    quoteValidityDays: raw.quoteValidityDays,
    coverageTypes,
    packages,
    addons,
  }
}
