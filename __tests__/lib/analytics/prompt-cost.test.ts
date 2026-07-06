/**
 * A2 (plan 2026-07-06): the prompt-cost report aggregates TurnDebug payloads
 * into per-phase averages — tokens/turn, call-level cache-hit rate,
 * stable/dynamic char split, identity-section share. The baseline note and
 * every workstream's after-measurement cite this report.
 */
import { describe, it, expect } from 'vitest'
import { buildPromptCostReport, formatPromptCostReport } from '@/lib/analytics/prompt-cost'

function turn(overrides: {
  conversationId?: string
  phase?: string
  promptTokens?: number
  cacheRead?: number
  llmCalls?: number
  cacheHitCalls?: number
  stableChars?: number
  dynamicChars?: number
  toolDefChars?: number
  identityChars?: number
  totalChars?: number
}) {
  return {
    conversationId: overrides.conversationId ?? 'conv-1',
    messageIndex: 0,
    payload: {
      gate: { derivedPhase: overrides.phase ?? 'DISCOVERY' },
      prompt: {
        sectionSizes: { agentIdentity: overrides.identityChars ?? 5000 },
        totalChars: overrides.totalChars ?? 10000,
        stablePrefixChars: overrides.stableChars ?? 8000,
        dynamicSuffixChars: overrides.dynamicChars ?? 2000,
      },
      totals: {
        totalInputTokens: overrides.promptTokens ?? 4000,
        totalOutputTokens: 100,
        totalCacheReadTokens: overrides.cacheRead ?? 0,
        totalCacheWriteTokens: 0,
        llmCalls: overrides.llmCalls ?? 1,
        cacheHitCalls: overrides.cacheHitCalls ?? 0,
        toolDefChars: overrides.toolDefChars ?? 3000,
      },
    },
  }
}

describe('buildPromptCostReport', () => {
  it('aggregates per-phase averages and call-level cache-hit rate', () => {
    const report = buildPromptCostReport([
      turn({ phase: 'DISCOVERY', promptTokens: 4000, cacheRead: 3000, llmCalls: 2, cacheHitCalls: 2 }),
      turn({ phase: 'DISCOVERY', promptTokens: 6000, cacheRead: 0, llmCalls: 2, cacheHitCalls: 0 }),
      turn({ phase: 'APPLICATION', conversationId: 'conv-2', promptTokens: 3000, cacheRead: 1000, llmCalls: 1, cacheHitCalls: 1 }),
    ])

    expect(report.turns).toBe(3)
    expect(report.conversations).toBe(2)

    const discovery = report.byPhase['DISCOVERY']
    expect(discovery.turns).toBe(2)
    expect(discovery.avgPromptTokens).toBe(5000)
    expect(discovery.cacheHitRate).toBe(0.5) // 2 of 4 calls
    expect(discovery.avgCacheReadTokens).toBe(1500)

    expect(report.byPhase['APPLICATION'].cacheHitRate).toBe(1)
    expect(report.overall.avgPromptTokens).toBeCloseTo((4000 + 6000 + 3000) / 3, 5)
  })

  it('tracks the prompt char split and identity share', () => {
    const report = buildPromptCostReport([
      turn({ stableChars: 9000, dynamicChars: 1000, identityChars: 4500, totalChars: 10000 }),
    ])
    const phase = report.byPhase['DISCOVERY']
    expect(phase.avgStablePrefixChars).toBe(9000)
    expect(phase.avgDynamicSuffixChars).toBe(1000)
    expect(phase.avgIdentityShare).toBeCloseTo(0.45, 5)
  })

  it('skips turns without totals (no LLM call ran) but counts them', () => {
    const report = buildPromptCostReport([
      { conversationId: 'c', messageIndex: 0, payload: { gate: { derivedPhase: 'DISCOVERY' } } },
      turn({}),
    ])
    expect(report.turns).toBe(2)
    expect(report.turnsWithoutUsage).toBe(1)
    expect(report.byPhase['DISCOVERY'].turns).toBe(2)
    expect(report.byPhase['DISCOVERY'].avgPromptTokens).toBe(4000) // only the measured turn
  })

  it('buckets turns with no derived phase as UNKNOWN', () => {
    const report = buildPromptCostReport([
      { conversationId: 'c', messageIndex: 0, payload: { totals: { totalInputTokens: 100, totalOutputTokens: 1, llmCalls: 1, cacheHitCalls: 0 } } },
    ])
    expect(report.byPhase['UNKNOWN'].turns).toBe(1)
  })
})

describe('formatPromptCostReport', () => {
  it('renders a markdown table with one row per phase plus overall', () => {
    const report = buildPromptCostReport([turn({ phase: 'DISCOVERY' }), turn({ phase: 'QUOTE', conversationId: 'c2' })])
    const md = formatPromptCostReport(report)
    expect(md).toContain('| Phase |')
    expect(md).toContain('| DISCOVERY |')
    expect(md).toContain('| QUOTE |')
    expect(md).toContain('| OVERALL |')
  })
})
