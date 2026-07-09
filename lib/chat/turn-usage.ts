/**
 * Per-turn LLM usage totals (A1 telemetry). One accumulator shared by every
 * LLM round of a turn — the tool loop can make several calls, and the
 * cache-hit rate per CALL (not per turn) is what the A2 cost report needs to
 * judge prefix-cache health.
 */

import type { TokenUsage } from '@/lib/llm/providers/types'

export interface TurnUsageTotals {
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  llmCalls: number
  cacheHitCalls: number
}

export function emptyTurnUsage(): TurnUsageTotals {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    llmCalls: 0,
    cacheHitCalls: 0,
  }
}

export function accumulateTurnUsage(totals: TurnUsageTotals, usage: TokenUsage): void {
  totals.totalInputTokens += usage.promptTokens
  totals.totalOutputTokens += usage.completionTokens
  totals.totalCacheReadTokens += usage.cacheReadTokens ?? 0
  totals.totalCacheWriteTokens += usage.cacheWriteTokens ?? 0
  totals.llmCalls += 1
  if ((usage.cacheReadTokens ?? 0) > 0) totals.cacheHitCalls += 1
}
