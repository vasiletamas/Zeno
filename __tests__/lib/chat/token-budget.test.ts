import { describe, it, expect } from 'vitest'
import { estimateTokens, calculateMessageBudget } from '@/lib/chat/token-budget'

describe('estimateTokens', () => {
  it('estimates English text at ~4 chars per token', () => {
    const text = 'Hello world'
    const tokens = estimateTokens(text, 'en')
    expect(tokens).toBeGreaterThanOrEqual(2)
    expect(tokens).toBeLessThanOrEqual(4)
  })

  it('estimates Romanian text at ~3 chars per token', () => {
    const text = 'Bună ziua'
    const tokens = estimateTokens(text, 'ro')
    expect(tokens).toBeGreaterThanOrEqual(2)
    expect(tokens).toBeLessThanOrEqual(4)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('', 'en')).toBe(0)
  })

  it('handles long text proportionally', () => {
    const text = 'a'.repeat(4000)
    const tokens = estimateTokens(text, 'en')
    expect(tokens).toBeGreaterThanOrEqual(900)
    expect(tokens).toBeLessThanOrEqual(1100)
  })
})

describe('calculateMessageBudget', () => {
  it('calculates available budget correctly', () => {
    const budget = calculateMessageBudget({
      modelContextWindow: 128_000,
      systemPromptTokens: 3000,
      toolDefinitionTokens: 2000,
      outputReservation: 4096,
      safetyMargin: 0.10,
    })
    expect(budget).toBe(Math.floor((128_000 - 3000 - 2000 - 4096) * 0.90))
  })

  it('returns 0 if budget would be negative', () => {
    const budget = calculateMessageBudget({
      modelContextWindow: 1000,
      systemPromptTokens: 500,
      toolDefinitionTokens: 500,
      outputReservation: 500,
      safetyMargin: 0.10,
    })
    expect(budget).toBe(0)
  })

  it('uses default 10% safety margin', () => {
    const budget = calculateMessageBudget({
      modelContextWindow: 10_000,
      systemPromptTokens: 1000,
      toolDefinitionTokens: 500,
      outputReservation: 500,
    })
    expect(budget).toBe(7200)
  })
})
