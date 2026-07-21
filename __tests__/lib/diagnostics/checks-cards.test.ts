/**
 * T11 ratchet: hallucinated_ui_reference — the assistant referenced a card
 * ("cardul afișat", "pe card") in a turn whose tool results carry NO
 * persisted card trace. Historical instance (2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme messageIndex 54 / assistant msg 55): the
 * completing write_question_answer succeeded WITHOUT a uiAction and the
 * model wrote "…confirmi declarațiile medicale pe cardul afișat" — the card
 * never existed and the customer was stranded.
 */
import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { makeExport, turn } from './export-helpers'

const msg = (role: 'user' | 'assistant', content: string) => ({ role, content }) as never

/** The conv cmrm3fgku turn-54 result shape: a successful completion WITHOUT a card. */
const completionWithoutCard = {
  round: 0, toolCallId: 'x', name: 'write_question_answer',
  args: { answer: 'nu', questionCode: 'BD_HOSPITALIZATION_RECENT' }, partition: 'writing',
  result: { success: true, durationMs: 1, cached: false, data: { answerSaved: true, isComplete: true, readyForQuote: true } },
}

/** Same commit WITH the T11 card riding the result — the legitimate emission. */
const completionWithCard = {
  ...completionWithoutCard,
  result: { ...completionWithoutCard.result, uiAction: { type: 'show_medical_review', payload: { applicationId: 'app_1', declarations: [] } } },
}

/** The persisted proxy of an orchestrator-synthesized confirm card: the
 * requires_confirmation envelope's data (_instruction + preview, success:false). */
const confirmCardTrace = {
  round: 0, toolCallId: 'x', name: 'sign_medical_declarations', args: {}, partition: 'writing',
  result: {
    success: false, durationMs: 1, cached: false,
    data: {
      preview: { declarations: [{ code: 'BD_CANCER_HISTORY', value: 'false' }] },
      _instruction: 'A confirmation card is now shown to the customer in the chat UI. Do NOT call this tool again yourself — the customer completes the action by tapping Confirm on the card. Briefly invite them to confirm using the card.',
    },
  },
}

const HALLUCINATED_PROSE = 'Mai rămâne să confirmi declarațiile medicale pe cardul afișat.'

describe('hallucinated_ui_reference', () => {
  it('flags assistant prose referencing a card when the turn emitted none (conv cmrm3fgku msg 54-56 shape)', () => {
    const e = makeExport({
      messages: [msg('user', 'nu'), msg('assistant', HALLUCINATED_PROSE)],
      turns: [turn(0, { toolCalls: [completionWithoutCard] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'hallucinated_ui_reference')).toMatchObject({
      severity: 'error',
      turn: 0,
      evidence: { claim: HALLUCINATED_PROSE.slice(0, 120) },
    })
  })

  it('stays silent when a tool result THIS turn carries the card (result.uiAction)', () => {
    const e = makeExport({
      messages: [msg('user', 'nu'), msg('assistant', HALLUCINATED_PROSE)],
      turns: [turn(0, { toolCalls: [completionWithCard] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'hallucinated_ui_reference')).toBe(false)
  })

  it('stays silent for the orchestrator-synthesized confirm card (requires_confirmation preview trace)', () => {
    const e = makeExport({
      messages: [msg('user', 'semnez'), msg('assistant', 'Te rog confirmă pe cardul afișat.')],
      turns: [turn(0, { toolCalls: [confirmCardTrace] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'hallucinated_ui_reference')).toBe(false)
  })

  it('matches diacritic-stripped variants ("de pe card") but never card-free prose', () => {
    const flagged = makeExport({
      messages: [msg('user', 'ok'), msg('assistant', 'Alege opțiunea de pe card, te rog.')],
      turns: [turn(0, { toolCalls: [] })] as never,
    })
    expect(runDiagnostics(flagged).some((f) => f.checkId === 'hallucinated_ui_reference')).toBe(true)

    const clean = makeExport({
      messages: [msg('user', 'ok'), msg('assistant', 'Mulțumesc, am tot ce îmi trebuie.')],
      turns: [turn(0, { toolCalls: [] })] as never,
    })
    expect(runDiagnostics(clean).some((f) => f.checkId === 'hallucinated_ui_reference')).toBe(false)
  })

  it('a card reference is LEGAL when the turn\'s briefing listed cards (T11 amendment, spec §5)', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'ce card?', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Poți ignora cardul afișat mai sus — nu mai este necesar.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, { briefedCards: [{ key: 'data_field:phone', status: 'active' }], toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'hallucinated_ui_reference')).toBe(false)
  })

  // The payload records the FULL derived set, but only data_field/otp families
  // are printed as card lines — a question:* entry never reaches the model as a
  // card, so it cannot license card prose (diagnostic ≡ constitution).
  it('an unprinted family (question:*) in briefedCards does NOT license card prose', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'ok', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Alege pe cardul afișat.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, { briefedCards: [{ key: 'question:BD_CANCER', status: 'active' }], toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'hallucinated_ui_reference')).toBe(true)
  })

  it('still flags a card reference with neither a tool trace nor briefed cards', () => {
    const e = makeExport({
      messages: [
        { id: 'u', role: 'user', content: 'ok', toolCalls: null, toolResults: null, createdAt: 'x' },
        { id: 'a', role: 'assistant', content: 'Alege pe cardul afișat.', toolCalls: null, toolResults: null, createdAt: 'x' },
      ] as never,
      turns: [turn(0, { toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((x) => x.checkId === 'hallucinated_ui_reference')).toBe(true)
  })

  it('user messages and assistant messages with no joined turn are never flagged', () => {
    const e = makeExport({
      messages: [msg('user', 'unde e cardul afisat?'), msg('assistant', 'Bună! Cu ce te pot ajuta?'), msg('assistant', 'Vezi cardul afișat mai sus.')],
      turns: [] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'hallucinated_ui_reference')).toBe(false)
  })
})
