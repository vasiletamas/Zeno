import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spec } from '@/lib/spec/registry'
import { parseWorkflowFeature } from '@/lib/spec/parse-workflow-feature'
import { decideQuoteIssue, type QuoteDecisionInput } from '@/lib/engines/quote-decision'

const parsed = parseWorkflowFeature(fs.readFileSync(
  path.join(process.cwd(), 'docs/tools as wokflow scenarios/zeno_workflow.feature'), 'utf8'))
const outline = parsed.scenarios.find((s) => s.tags.includes('@id:quote_generation/can-reject-or-refer-with-reason'))!
// live rows only — the @backlog Examples block records spec<->code
// divergences (ineligible_age naming, unbuilt pending path); this test reads
// straight from the AST so an F3 row edit flips expectations automatically
const rows = outline.examples.filter((e) => !e.tags.includes('@backlog')).flatMap((e) => e.rows)

// Deviation from the plan literal: the shipped pure gate is decideQuoteIssue
// over QuoteDecisionInput (quote-decision.ts), not a snapshot-shaped
// planGenerateQuote in quote-lifecycle.ts.
function decisionInput(over: Partial<QuoteDecisionInput> = {}): QuoteDecisionInput {
  return {
    eligibility: { verdict: 'eligible', failedRules: [], missingFacts: [] },
    suitability: { verdict: 'suitable', mismatches: [] },
    suitabilityWarningAcked: false,
    suitabilityPolicy: 'warn_and_allow',
    consents: { gdprProcessing: true },
    dnt: { validForProductType: true },
    identity: { hasDobOrCnp: true },
    escalationFlags: [],
    ...over,
  }
}

const INPUT_FOR: Record<string, () => QuoteDecisionInput> = {
  compliance_block: () => decisionInput({ consents: { gdprProcessing: false } }),
  manual_underwriting: () => decisionInput({ escalationFlags: ['bd_referral'] }),
}

describe(spec('quote_generation/can-reject-or-refer-with-reason'), () => {
  it.each(rows)('row %#: -> %s / %s', (outcome, reason) => {
    const make = INPUT_FOR[reason]
    expect(make, `no input for reason "${reason}" — extend INPUT_FOR`).toBeDefined()
    const result = decideQuoteIssue(make())
    expect(result.outcome).toBe(outcome)
    expect('reason' in result ? result.reason : undefined).toBe(reason)
  })
})
