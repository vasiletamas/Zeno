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

  // T11 clause 7 (2026-07-15, conv cmrm3fgku00056g0y4eb2hsme msgs 54-56):
  // the model wrote "confirmi declarațiile medicale pe cardul afișat" while
  // NO tool result had emitted a card — the customer was stranded confirming
  // a control that never existed. Enforced offline by the
  // hallucinated_ui_reference diagnostics check.
  it('forbids referencing cards no tool result emitted THIS turn (T11 clause 7)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ONLY when a tool result THIS turn emitted one'),
      ]),
    )
    const rule = (parsed as string[]).find((c) => c.includes('THIS turn emitted one'))
    expect(rule).toContain('ONE short invite line')
    expect(rule).toContain('never claim one exists')
  })

  // T13 supersession clause (2026-07-17, conv cmrm3fgku00056g0y4eb2hsme
  // messageIndex 58): a GUI sign_medical_declarations result said "The quote
  // can be generated now."; the model still told the customer the calculation
  // was impossible because the turn-start CURRENT SYSTEM STATE section said
  // the quote was blocked — no rule told it fresh results outrank it.
  it('carries the freshest-evidence-wins supersession clause (T13)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    const parsed = JSON.parse(mainChat!.constraints as string)
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Freshest evidence wins'),
      ]),
    )
    const rule = (parsed as string[]).find((c) => c.includes('Freshest evidence wins'))
    expect(rule).toContain('[State update]')
    expect(rule).toContain('SUPERSEDES the CURRENT SYSTEM STATE section')
    expect(rule).toContain('attempt the action instead of claiming it is unavailable')
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
  it('forbids re-collecting known customer fields (the batch re-send loop, 2026-07-06 battery)', () => {
    const mainChat = AGENTS.find((a) => a.slug === 'main-chat')
    expect(mainChat?.systemPrompt).toMatch(/CUSTOMER FIELD DISCIPLINE/)
    expect(mainChat?.systemPrompt).toMatch(/NEVER re-collect a field/i)
    expect(mainChat?.systemPrompt).toMatch(/never ask the customer to retype/i)
  })
})
