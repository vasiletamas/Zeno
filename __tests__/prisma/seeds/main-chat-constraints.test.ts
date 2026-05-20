import { describe, it, expect } from 'vitest'
import { AGENTS } from '@/prisma/seeds/seed-agents'

describe('main-chat agent constraints', () => {
  it('includes the set_conversation_product confirmation rule', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat).toBeDefined()
    expect(mainChat?.constraints).toBeTruthy()
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('set_conversation_product'),
      ]),
    )
  })

  it('keeps all original constraint rules', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        'No invented URLs or links',
        'No fake forms — system handles UI',
        'No promises without tool actions',
        'Past tense for completed actions',
        'Insurance and financial services only',
      ]),
    )
  })

  it('includes the CURRENT SYSTEM STATE grounding rule', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CURRENT SYSTEM STATE'),
      ]),
    )
  })

  it('reasoning-gate system prompt contains the current-message-priority rule', () => {
    const gate = AGENTS.find((a) => a.slug === 'reasoning-gate')
    expect(gate).toBeDefined()
    expect(gate?.systemPrompt).toMatch(/current message overrides the stored interests/i)
  })
})
