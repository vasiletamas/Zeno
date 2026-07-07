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

  // E1 (2026-07-07): the discovery guardrails moved from systemPrompt to
  // promptSections.discoveryConduct (ships on DISCOVERY + QUOTE turns).
  // These pins follow the content to its new home — see the inventory note §7.
  it('discovery conduct tells the agent to use the catalog overview, not query blind', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const conduct = mainChat?.promptSections?.discoveryConduct
    expect(conduct).toMatch(/USE THE CATALOG OVERVIEW/)
    expect(conduct).toMatch(/Do NOT call list_products for a category the catalog shows is empty/)
  })

  it('discovery conduct requires fetching before quoting product specifics', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const conduct = mainChat?.promptSections?.discoveryConduct
    expect(conduct).toMatch(/NAME FROM THE CATALOG, QUOTE FROM THE TOOL/)
    expect(conduct).toMatch(/may NOT state its product code, describe its features/)
  })

  it('discovery conduct grounds discovery questions in product dimensions', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.promptSections?.discoveryConduct).toMatch(/DISCOVERY QUESTIONS MUST BE GROUNDED/)
  })

  it('discovery conduct distinguishes derived pricing examples from specific quotes (E1.8)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const conduct = mainChat?.promptSections?.discoveryConduct
    expect(conduct).toMatch(/SPECIFIC PRICES ONLY VIA QUOTE/)
    expect(conduct).toMatch(/pricing_examples/)
    // the retired column left EVERY seeded prompt surface
    const allSurfaces = (mainChat?.systemPrompt ?? '') + Object.values(mainChat?.promptSections ?? {}).join('')
    expect(allSurfaces).not.toMatch(/premiumRange/)
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
})
