/**
 * Per-turn usage accumulation (plan 2026-07-06 A1b): every LLM round's
 * TokenUsage — including the A1a cache fields — rolls up into the turn
 * totals that feed debug:turn_end, TurnTrace and the A2 cost report.
 */
import { describe, it, expect } from 'vitest'
import { emptyTurnUsage, accumulateTurnUsage } from '@/lib/chat/turn-usage'

describe('accumulateTurnUsage', () => {
  it('accumulates tokens, cache tokens, call and hit counts across rounds', () => {
    const totals = emptyTurnUsage()
    accumulateTurnUsage(totals, {
      promptTokens: 1000, completionTokens: 50, totalTokens: 1050,
      cacheReadTokens: 800, cacheWriteTokens: 0,
    })
    accumulateTurnUsage(totals, {
      promptTokens: 1200, completionTokens: 80, totalTokens: 1280,
      cacheReadTokens: 0, cacheWriteTokens: 900,
    })

    expect(totals.totalInputTokens).toBe(2200)
    expect(totals.totalOutputTokens).toBe(130)
    expect(totals.totalCacheReadTokens).toBe(800)
    expect(totals.totalCacheWriteTokens).toBe(900)
    expect(totals.llmCalls).toBe(2)
    expect(totals.cacheHitCalls).toBe(1)
  })

  it('treats absent cache fields as zero (no hit)', () => {
    const totals = emptyTurnUsage()
    accumulateTurnUsage(totals, { promptTokens: 100, completionTokens: 10, totalTokens: 110 })

    expect(totals.totalInputTokens).toBe(100)
    expect(totals.totalCacheReadTokens).toBe(0)
    expect(totals.totalCacheWriteTokens).toBe(0)
    expect(totals.llmCalls).toBe(1)
    expect(totals.cacheHitCalls).toBe(0)
  })
})
