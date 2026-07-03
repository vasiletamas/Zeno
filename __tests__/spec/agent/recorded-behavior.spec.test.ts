import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { spec } from '@/lib/spec/registry'
import { toToolName } from '@/lib/spec/operations-map'
import type { ConversationExport } from '@/lib/debug/conversation-export'
import {
  assertToolOrder, assertToolNeverCalled, assertNoNarrationViolations,
  assertNoPhaseRegression, assertNoPremiumBeforeQuote, toolCallsByTurn,
} from '@/lib/testing/conversation-assertions'

const FIXTURES_DIR = path.join(process.cwd(), '__tests__/fixtures/exports')
const load = (name: string): ConversationExport => JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'))

describe('agent behavior over recorded sims (T12.D4 — assertion substrate is the export)', () => {
  const happy = load('happy-path.export.json')
  it(spec('contract/failed-commit-surfaced-not-narrated') + ' no narration violations on the happy path', () => {
    expect(() => assertNoNarrationViolations(happy)).not.toThrow()
  })
  it(spec('contract/never-advance-phase-by-narration') + ' phases only move forward and only via commits', () => {
    expect(() => assertNoPhaseRegression(happy)).not.toThrow()
  })
  it(spec('discovery/example-prices-only-from-product-data') + ' no premium claims before an issued quote', () => {
    expect(() => assertNoPremiumBeforeQuote(happy)).not.toThrow()
  })
  it(spec('dnt/walking-questions-one-at-a-time') + ' DNT tool order open -> write -> sign', () => {
    expect(() => assertToolOrder(happy, [toToolName('start_dnt_session'), toToolName('write_dnt_answer'), toToolName('sign_dnt')])).not.toThrow()
  })
  it(spec('payment/agent-never-handles-card-data') + ' no tool call carries card fields', () => {
    for (const t of happy.turns) for (const c of t.toolCalls) {
      expect(JSON.stringify(c.args)).not.toMatch(/card_number|cvv|pan\b/i)
    }
  })
  const refusal = load('dnt-refusal.export.json')
  it(spec('dnt/refused-consent-blocks-funnel') + ' after refusal no funnel commit is attempted', () => {
    const after = toolCallsByTurn(refusal).flat()
    expect(() => assertToolNeverCalled(refusal, toToolName('generate_quote'))).not.toThrow()
    expect(after.filter((n) => n === toToolName('sign_dnt')).length).toBeLessThanOrEqual(1)
  })
})
