import { describe, it, expect } from 'vitest'
import { AGENTS } from '@/prisma/seeds/seed-agents'

// T3 (2026-07-15 live test): the live DB row was switched to gpt-5.6-sol
// deliberately, but the seed still said gpt-5.4 — any reseed silently
// reverted the model. The seed is the durable ruling.
describe('main-chat agent model config', () => {
  it('defaults to gpt-5.6-sol with claude-sonnet-5 fallback', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat).toMatchObject({
      provider: 'OPENAI',
      model: 'gpt-5.6-sol',
      fallbackProvider: 'ANTHROPIC',
      fallbackModel: 'claude-sonnet-5',
    })
  })
})
