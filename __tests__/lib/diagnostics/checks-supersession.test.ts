/**
 * T13 ratchet: stale_gate_claim — a tool result THIS turn said an action is
 * now possible, the turn made ZERO calls to that action, and the assistant
 * claimed the action's domain is impossible. Historical instance (2026-07-15,
 * conv cmrm3fgku00056g0y4eb2hsme messageIndex 58): a GUI
 * sign_medical_declarations result carried "The quote can be generated now.";
 * the model answered "calcularea nu poate fi finalizată în această
 * conversație" without a single generate_quote attempt — the gate was open
 * (the next user turn quoted instantly).
 */
import { describe, it, expect } from 'vitest'
import { runDiagnostics } from '@/lib/diagnostics'
import { makeExport, turn } from './export-helpers'

const msg = (role: 'user' | 'assistant', content: string) => ({ role, content }) as never

/** The conv cmrm3fgku turn-58 result shape: the applied signature whose
 * _message announces the quote gate is open. */
const signResult = {
  round: 0, toolCallId: 'x', name: 'sign_medical_declarations', args: {}, partition: 'writing',
  result: {
    success: true, durationMs: 1, cached: false,
    data: { _message: 'Medical declarations signed — 3 answers affirmed in one signature. The quote can be generated now.' },
  },
}

const quoteAttempt = {
  round: 1, toolCallId: 'y', name: 'generate_quote', args: {}, partition: 'writing',
  result: { success: true, durationMs: 1, cached: false, data: {} },
}

const REFUSAL_PROSE = 'Îmi pare rău, calcularea cotației nu poate fi finalizată în această conversație.'

describe('stale_gate_claim', () => {
  it('flags the messageIndex-58 shape: enabling result + impossibility prose + zero calls to the action', () => {
    const e = makeExport({
      messages: [msg('user', '[Action: sign_medical_declarations]'), msg('assistant', REFUSAL_PROSE)],
      turns: [turn(0, { toolCalls: [signResult] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'stale_gate_claim')).toMatchObject({
      severity: 'error',
      turn: 0,
      evidence: {
        action: 'generate_quote',
        resultMessage: expect.stringContaining('The quote can be generated now'),
        claim: REFUSAL_PROSE.slice(0, 120),
      },
    })
  })

  it('stays silent when generate_quote WAS called that turn (even with the same prose)', () => {
    const e = makeExport({
      messages: [msg('user', '[Action: sign_medical_declarations]'), msg('assistant', REFUSAL_PROSE)],
      turns: [turn(0, { toolCalls: [signResult, quoteAttempt] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'stale_gate_claim')).toBe(false)
  })

  it('stays silent for refusal prose with no enabling result that turn', () => {
    const e = makeExport({
      messages: [msg('user', 'vreau oferta'), msg('assistant', REFUSAL_PROSE)],
      turns: [turn(0, { toolCalls: [] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'stale_gate_claim')).toBe(false)
  })

  it('stays silent when the assistant does NOT claim impossibility about that domain', () => {
    const e = makeExport({
      messages: [msg('user', '[Action: sign_medical_declarations]'), msg('assistant', 'Declarațiile sunt semnate — generez oferta acum.')],
      turns: [turn(0, { toolCalls: [signResult] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'stale_gate_claim')).toBe(false)
  })

  it('maps the sign_dnt enabling message ("Ready for signature (sign_dnt)") to sign_dnt', () => {
    const dntComplete = {
      round: 0, toolCallId: 'x', name: 'write_dnt_answer', args: {}, partition: 'writing',
      result: {
        success: true, durationMs: 1, cached: false,
        data: { _message: 'All DNT questions answered. Ready for signature (sign_dnt).' },
      },
    }
    const e = makeExport({
      messages: [msg('user', 'da'), msg('assistant', 'Din păcate nu se poate semna acum în această conversație.')],
      turns: [turn(0, { toolCalls: [dntComplete] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'stale_gate_claim')).toMatchObject({
      severity: 'error',
      turn: 0,
      evidence: { action: 'sign_dnt' },
    })
  })

  it('maps the sign_dnt applied message ("can now proceed with insurance applications") to set_application', () => {
    const dntSigned = {
      round: 0, toolCallId: 'x', name: 'sign_dnt', args: {}, partition: 'writing',
      result: {
        success: true, durationMs: 1, cached: false,
        data: { _message: 'DNT successfully signed. Customer can now proceed with insurance applications.' },
      },
    }
    const e = makeExport({
      messages: [msg('user', '[Action: sign_dnt]'), msg('assistant', 'Nu pot deschide aplicația de asigurare în acest moment.')],
      turns: [turn(0, { toolCalls: [dntSigned] })] as never,
    })
    expect(runDiagnostics(e).find((f) => f.checkId === 'stale_gate_claim')).toMatchObject({
      severity: 'error',
      turn: 0,
      evidence: { action: 'set_application' },
    })
  })

  it('requires the domain keyword NEAR the impossibility phrase (unrelated refusals stay silent)', () => {
    // "nu pot" exists but is about medical advice, far from any quote keyword
    const e = makeExport({
      messages: [msg('user', '[Action: sign_medical_declarations]'), msg('assistant', 'Nu pot să îți dau sfaturi medicale. Revenim la asigurare când dorești.')],
      turns: [turn(0, { toolCalls: [signResult] })] as never,
    })
    expect(runDiagnostics(e).some((f) => f.checkId === 'stale_gate_claim')).toBe(false)
  })
})
