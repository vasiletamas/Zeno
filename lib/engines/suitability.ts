/**
 * Suitability engine (C3, M7 demands-and-needs): ONE typed, versioned rule
 * source and ONE pure evaluator, sibling of lib/engines/eligibility.ts —
 * consumed by DerivedStateV3 post-sign_dnt (C3.3), the documented-warning
 * ack flow (C3.4) and D1's generate_quote gate (C3.5). Facts are the
 * customer's signed DNT answers (questionCode → value); missing facts never
 * fire rules — sign_dnt guarantees the visible DNT set is complete.
 */
import { z } from 'zod'

export const SuitabilityRuleSchema = z.object({
  id: z.string().min(1),
  fact: z.string().min(1),                          // DNT question code
  op: z.enum(['equals', 'in', 'not_in']),
  value: z.unknown(),
  whenMatched: z.enum(['mismatch', 'conditional']),
  reason: z.string().regex(/^[a-z0-9_]+$/),          // stable snake_case (M6)
})
export const SuitabilityRuleSetSchema = z.object({
  version: z.number().int().positive(),
  mode: z.enum(['hard_block', 'warn_and_allow']),    // product config field (M7.2)
  rules: z.array(SuitabilityRuleSchema),
}).strict()
export type SuitabilityRule = z.infer<typeof SuitabilityRuleSchema>
export type SuitabilityRuleSet = z.infer<typeof SuitabilityRuleSetSchema>
export function parseSuitabilityRuleSet(raw: unknown): SuitabilityRuleSet {
  return SuitabilityRuleSetSchema.parse(raw)
}

export type SuitabilityVerdict = 'suitable' | 'conditionally_suitable' | 'unsuitable'
export interface SuitabilityResult {
  verdict: SuitabilityVerdict
  mismatches: { rule: SuitabilityRule; reason: string }[]
}

function fires(rule: SuitabilityRule, fact: string | undefined): boolean {
  if (fact === undefined || fact === null) return false
  switch (rule.op) {
    case 'equals': return fact === String(rule.value)
    case 'in': return (rule.value as unknown[]).map(String).includes(fact)
    case 'not_in': return !(rule.value as unknown[]).map(String).includes(fact)
  }
}

export function evaluateSuitability(
  ruleSet: SuitabilityRuleSet,
  dntFacts: Record<string, string>,
): SuitabilityResult {
  const mismatches: SuitabilityResult['mismatches'] = []
  let hardMismatch = false
  for (const rule of ruleSet.rules) {
    if (!fires(rule, dntFacts[rule.fact])) continue
    mismatches.push({ rule, reason: rule.reason })
    if (rule.whenMatched === 'mismatch') hardMismatch = true
  }
  const verdict: SuitabilityVerdict =
    mismatches.length === 0 ? 'suitable' : hardMismatch ? 'unsuitable' : 'conditionally_suitable'
  return { verdict, mismatches }
}
