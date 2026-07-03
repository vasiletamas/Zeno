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

/**
 * Presentation age bounds DERIVED from the product rules (C2.3, #9 rule 3):
 * the numbers customers see are the numbers the engine enforces — no
 * authored numeric shadow copy to drift.
 */
export function deriveEligibilityBounds(ruleSet: EligibilityRuleSet): { minAge: number | null; maxAge: number | null } {
  let minAge: number | null = null
  let maxAge: number | null = null
  for (const r of ruleSet.rules) {
    if (r.subject !== 'product' || r.fact !== 'age') continue
    if (r.op === 'gte') minAge = Math.max(minAge ?? -Infinity, Number(r.value))
    if (r.op === 'lte') maxAge = Math.min(maxAge ?? Infinity, Number(r.value))
    if (r.op === 'between') {
      const [lo, hi] = r.value as [number, number]
      minAge = Math.max(minAge ?? -Infinity, lo)
      maxAge = Math.min(maxAge ?? Infinity, hi)
    }
  }
  return { minAge, maxAge }
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
