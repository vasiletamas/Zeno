import { describe, it, expect } from 'vitest'
import { buildConfirmAction, CONFIRMABLE_TOOLS } from '@/components/chat/rich/confirm-required-card'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('confirm_required GUI consumer (A3 erratum 5)', () => {
  it('the confirm click posts the SAME commit with the gateway-issued token', () => {
    const action = buildConfirmAction('accept_quote', 'tok-1')
    expect(action).toEqual({ type: 'accept_quote', payload: { confirmToken: 'tok-1' } })
    // and the adapter turns it into the identical tool call the agent would make
    const tc = adaptAction(action!)
    expect(tc?.name).toBe('accept_quote')
    expect(tc?.arguments).toEqual({ confirmToken: 'tok-1' })
  })
  it('sign_dnt round-trips with the explicit consent grant (B1.5 — the CTA is the consent capture)', () => {
    const action = buildConfirmAction('sign_dnt', 'tok-2')
    expect(adaptAction(action!)?.arguments).toEqual({ consent: { gdpr: true, aiDisclosure: true }, confirmToken: 'tok-2' })
  })
  it('non-confirmable tools produce no action (defense against forged events)', () => {
    expect(buildConfirmAction('escalate_to_human', 'tok-3')).toBeNull()
    expect(CONFIRMABLE_TOOLS).toEqual(['sign_dnt', 'accept_quote', 'write_question_answer', 'modify_answer'])
  })
  it('BD medical sensitive answers round-trip: write_question_answer confirm carries answer + code + token (P0-6, 2026-07-06)', () => {
    const action = buildConfirmAction('write_question_answer', 'tok-4', { answer: 'da', questionCode: 'BD_CANCER_HISTORY' })
    expect(action).not.toBeNull()
    const tc = adaptAction(action!)
    expect(tc?.name).toBe('write_question_answer')
    expect(tc?.arguments).toEqual({ answer: 'da', questionCode: 'BD_CANCER_HISTORY', confirmToken: 'tok-4' })
  })
  it('modify_answer confirm carries code + newValue + token (P0-6)', () => {
    const action = buildConfirmAction('modify_answer', 'tok-5', { questionCode: 'BD_CANCER_HISTORY', newValue: 'nu' })
    expect(action).not.toBeNull()
    const tc = adaptAction(action!)
    expect(tc?.name).toBe('modify_answer')
    expect(tc?.arguments).toEqual({ questionCode: 'BD_CANCER_HISTORY', newValue: 'nu', confirmToken: 'tok-5' })
  })
})
