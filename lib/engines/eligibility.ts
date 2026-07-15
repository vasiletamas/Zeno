/**
 * Canonical eligibility module (C2, #9): ONE typed, versioned rule source
 * and ONE pure three-valued evaluator consumed by discovery (DerivedStateV3
 * verdict), the C1 consequence planner (eligibility edges), and D1's
 * generate_quote gate. Landed with C1.3 (the planner imports it) per the
 * block-C contract-first rule; C2 wires the consumption points.
 */
import { z } from 'zod'

export const EligibilityRuleSchema = z.object({
  id: z.string().min(1),
  subject: z.enum(['product', 'addon']),
  fact: z.string().min(1),          // 'age' | 'residency' | 'answer:<code>' | future facts
  op: z.enum(['gte', 'lte', 'between', 'equals', 'in', 'is_false', 'is_true']),
  value: z.unknown().optional(),
  reason: z.string().regex(/^[a-z0-9_]+$/), // stable snake_case ReasonCode (M6)
})
export const EligibilityRuleSetSchema = z.object({
  version: z.number().int().positive(),
  rules: z.array(EligibilityRuleSchema),
  narrative: z.unknown().optional(), // authored presentation text, never evaluated
}).strict()

export type EligibilityRule = z.infer<typeof EligibilityRuleSchema>
export type EligibilityRuleSet = z.infer<typeof EligibilityRuleSetSchema>

export function parseEligibilityRuleSet(raw: unknown): EligibilityRuleSet {
  return EligibilityRuleSetSchema.parse(raw)
}

export interface EligibilityBounds { minAge: number | null; maxAge: number | null; otherRuleCodes: string[] }

/**
 * Presentation age bounds DERIVED from the product rules (C2.3 + E1.5,
 * #9 rule 3): the numbers customers see are the numbers the engine
 * enforces — no authored numeric shadow copy to drift. Non-age PRODUCT
 * rules are listed by rule id so presentation can name them without
 * restating their logic; addon rules stay out (they gate the addon,
 * not the product).
 */
export function deriveEligibilityBounds(ruleSet: EligibilityRuleSet): EligibilityBounds {
  let minAge: number | null = null
  let maxAge: number | null = null
  const otherRuleCodes: string[] = []
  for (const r of ruleSet.rules) {
    if (r.subject !== 'product') continue
    if (r.fact !== 'age') { otherRuleCodes.push(r.id); continue }
    if (r.op === 'gte') minAge = Math.max(minAge ?? -Infinity, Number(r.value))
    if (r.op === 'lte') maxAge = Math.min(maxAge ?? Infinity, Number(r.value))
    if (r.op === 'between') {
      const [lo, hi] = r.value as [number, number]
      minAge = Math.max(minAge ?? -Infinity, lo)
      maxAge = Math.min(maxAge ?? Infinity, hi)
    }
  }
  return { minAge, maxAge, otherRuleCodes }
}

/**
 * The addon age rule DERIVED from the seeded AddonPricingRule bands (C2.4):
 * a no-match age is an INELIGIBILITY fact, never a silent price 0. Bands
 * must be contiguous — an envelope over gapped bands would silently declare
 * hole-ages eligible (erratum 4), so gaps are a hard authoring error.
 */
export function deriveAddonAgeRules(bands: { minAge: number; maxAge: number }[]): EligibilityRule[] {
  if (bands.length === 0) return []
  const sorted = [...bands].sort((a, b) => a.minAge - b.minAge)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minAge !== sorted[i - 1].maxAge + 1) {
      throw new Error(`addon age bands are not contiguous: ${sorted[i - 1].minAge}-${sorted[i - 1].maxAge} then ${sorted[i].minAge}-${sorted[i].maxAge} — the derived envelope would declare hole-ages eligible`)
    }
  }
  const lo = sorted[0].minAge
  const hi = sorted[sorted.length - 1].maxAge
  return [{ id: 'addon_age_band', subject: 'addon', fact: 'age', op: 'between', value: [lo, hi], reason: 'addon_age_band_unavailable' }]
}

export type EligibilityVerdict = 'eligible' | 'ineligible' | 'unknown'
export type KnownFacts = Record<string, string | number | boolean | null | undefined>
export interface EligibilityResult {
  verdict: EligibilityVerdict
  failedRules: { rule: EligibilityRule; reason: string }[]
  missingFacts: string[]
}

function normalizeBoolean(v: string | number | boolean): string | null {
  const lower = String(v).toLowerCase().trim()
  if (['true', 'yes', 'da', '1'].includes(lower)) return 'true'
  if (['false', 'no', 'nu', '0'].includes(lower)) return 'false'
  return null
}

function ruleHolds(rule: EligibilityRule, fact: string | number | boolean): boolean {
  switch (rule.op) {
    case 'gte': return Number(fact) >= Number(rule.value)
    case 'lte': return Number(fact) <= Number(rule.value)
    case 'between': {
      const [lo, hi] = rule.value as [number, number]
      return Number(fact) >= lo && Number(fact) <= hi
    }
    case 'equals': return String(fact) === String(rule.value)
    case 'in': return (rule.value as unknown[]).map(String).includes(String(fact))
    case 'is_false': return normalizeBoolean(fact) === 'false'
    case 'is_true': return normalizeBoolean(fact) === 'true'
  }
}

export type QuoteEligibilityGate =
  | { ok: true }
  | { ok: false; outcome: 'rejected'; reason: string; params: Record<string, unknown> }
  | { ok: false; outcome: 'requires_identity'; reason: 'eligibility_facts_missing'; params: { needs: string[] } }

/**
 * Final-authority gate for generate_quote (C2.6 — D1 is the host; this is
 * the whole decision). Erratum 2: missing IDENTITY-class facts (age,
 * residency) demand identity; missing 'answer:*' facts are questionnaire
 * incompleteness and REJECT (defense-in-depth — legality already keeps
 * generate_quote unexposed while the questionnaire is incomplete).
 */
export function gateQuoteEligibility(
  ruleSet: EligibilityRuleSet,
  knownFacts: KnownFacts,
  includesAddon: boolean,
): QuoteEligibilityGate {
  const product = evaluateEligibility(ruleSet, knownFacts, 'product')
  if (product.verdict === 'ineligible') {
    return { ok: false, outcome: 'rejected', reason: product.failedRules[0].reason, params: { failedRules: product.failedRules.map(f => f.rule.id) } }
  }
  const addon = includesAddon ? evaluateEligibility(ruleSet, knownFacts, 'addon') : null
  if (addon?.verdict === 'ineligible') {
    return { ok: false, outcome: 'rejected', reason: addon.failedRules[0].reason, params: { failedRules: addon.failedRules.map(f => f.rule.id) } }
  }
  const missing = [...new Set([...product.missingFacts, ...(addon?.missingFacts ?? [])])]
  const identityNeeds = missing.filter((f) => !f.startsWith('answer:'))
  if (identityNeeds.length > 0) {
    return { ok: false, outcome: 'requires_identity', reason: 'eligibility_facts_missing', params: { needs: identityNeeds } }
  }
  if (missing.length > 0) {
    return { ok: false, outcome: 'rejected', reason: 'eligibility_facts_missing', params: { needs: missing } }
  }
  return { ok: true }
}

/**
 * Three-valued: a failed rule wins over missing facts (ineligible beats
 * unknown — early decisive signal); unknown NEVER falls back to a silent
 * default (no age-30 guessing, #9 rule 2).
 */
export function evaluateEligibility(
  ruleSet: EligibilityRuleSet,
  knownFacts: KnownFacts,
  subject?: 'product' | 'addon',
): EligibilityResult {
  const rules = subject ? ruleSet.rules.filter(r => r.subject === subject) : ruleSet.rules
  const failedRules: EligibilityResult['failedRules'] = []
  const missingFacts: string[] = []
  for (const rule of rules) {
    const fact = knownFacts[rule.fact]
    if (fact === null || fact === undefined) { missingFacts.push(rule.fact); continue }
    if (!ruleHolds(rule, fact)) failedRules.push({ rule, reason: rule.reason })
  }
  const verdict: EligibilityVerdict =
    failedRules.length > 0 ? 'ineligible' : missingFacts.length > 0 ? 'unknown' : 'eligible'
  return { verdict, failedRules, missingFacts: [...new Set(missingFacts)] }
}
