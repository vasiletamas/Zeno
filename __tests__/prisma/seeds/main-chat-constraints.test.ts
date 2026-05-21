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

  it('includes the forbidden-phrase rule (subsystem C)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Forbidden examples'),
      ]),
    )
  })

  it('main-chat system prompt has the CATALOG FIRST rule', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/CATALOG FIRST/)
    expect(mainChat?.systemPrompt).toMatch(/list_products.*matching category/i)
  })

  it('main-chat system prompt forbids naming unfetched products', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/NEVER NAME OR QUOTE A PRODUCT YOU HAVEN'T FETCHED/)
  })

  it('main-chat system prompt grounds discovery questions in product dimensions', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/DISCOVERY QUESTIONS MUST BE GROUNDED/)
  })

  it('main-chat system prompt distinguishes pricing ranges from specific quotes', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/SPECIFIC PRICES ONLY VIA QUOTE/)
    expect(mainChat?.systemPrompt).toMatch(/premiumRange/)
  })
})
