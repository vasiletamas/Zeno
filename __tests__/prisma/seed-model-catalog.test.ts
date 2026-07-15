import { describe, it, expect } from 'vitest'
import { MODELS } from '@/prisma/seeds/seed-model-catalog'

// T2 (2026-07-15 live test): the main-chat agent runs gpt-5.6-sol live, but the
// catalog seed had no row for it — a reseed would leave turn-cost accounting
// against a missing model. Same for the seeded fallback claude-sonnet-5.
describe('seed-model-catalog rows', () => {
  it('has a gpt-5.6-sol row (placeholder pricing, tool-capable)', () => {
    const row = MODELS.find((m) => m.provider === 'OPENAI' && m.modelId === 'gpt-5.6-sol')
    expect(row).toBeDefined()
    expect(row).toMatchObject({
      supportsStreaming: true,
      supportsTools: true,
      contextWindow: 128_000,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
    })
  })

  it('has a claude-sonnet-5 row (main-chat seeded fallback must be costable)', () => {
    const row = MODELS.find((m) => m.provider === 'ANTHROPIC' && m.modelId === 'claude-sonnet-5')
    expect(row).toBeDefined()
    expect(row).toMatchObject({ supportsStreaming: true, supportsTools: true })
  })

  it('keeps provider+modelId unique (upsert key)', () => {
    const keys = MODELS.map((m) => `${m.provider}/${m.modelId}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
