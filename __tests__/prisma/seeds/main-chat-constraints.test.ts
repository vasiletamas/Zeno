import { describe, it, expect } from 'vitest'
import { AGENTS } from '@/prisma/seeds/seed-agents'

describe('main-chat agent constraints', () => {
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

  it('includes the forbidden-phrase rule (subsystem C)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Forbidden examples'),
      ]),
    )
  })

  it('main-chat system prompt tells the agent to use the catalog overview, not query blind', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/USE THE CATALOG OVERVIEW/)
    expect(mainChat?.systemPrompt).toMatch(/Do NOT call list_products for a category the catalog shows is empty/)
  })

  it('main-chat system prompt requires fetching before quoting product specifics', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/NAME FROM THE CATALOG, QUOTE FROM THE TOOL/)
    expect(mainChat?.systemPrompt).toMatch(/may NOT state its product code, describe its features/)
  })

  it('main-chat system prompt grounds discovery questions in product dimensions', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/DISCOVERY QUESTIONS MUST BE GROUNDED/)
  })

  it('main-chat system prompt distinguishes derived pricing examples from specific quotes (E1.8)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/SPECIFIC PRICES ONLY VIA QUOTE/)
    expect(mainChat?.systemPrompt).toMatch(/pricing_examples/)
    expect(mainChat?.systemPrompt).not.toMatch(/premiumRange/) // the retired column left the prompt
  })

  it('routes tier/level/addon through select_coverage after set_application (B4)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/set_application/)
    expect(mainChat?.systemPrompt).toMatch(/select_coverage/)
    expect(mainChat?.systemPrompt).not.toMatch(/start_application/)
    expect(mainChat?.systemPrompt).toMatch(/not re-?ask/i)
  })
  it('requires honest tool-error handling (no silent "not available")', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/success:\s*false/i)
    expect(mainChat?.systemPrompt).toMatch(/read the error/i)
  })
  it('requires generate_quote immediately on completion', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/COMPLETION RULE/i)
    expect(mainChat?.systemPrompt).toMatch(/(isComplete|readyForQuote)[^\n]*generate_quote/i)
  })
  it('carries the tool-failure protocol (Task 1.3, D8): typed errorCode policy, confirmed-failure apology, no silent re-confirmation', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/TOOL FAILURE PROTOCOL/)
    expect(mainChat?.systemPrompt).toMatch(/errorCode/)
    expect(mainChat?.systemPrompt).toMatch(/NEVER silently re-issue a confirmation/i)
    expect(mainChat?.systemPrompt).toMatch(/escalate_to_human/)
    expect(mainChat?.systemPrompt).toMatch(/repeated_failure/)
    // customer-facing prose stays clean: apologize + plain words, no internals
    expect(mainChat?.systemPrompt).toMatch(/something went wrong on our side/i)
  })
})
