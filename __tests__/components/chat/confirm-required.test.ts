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
    // P2-15: EVERY requiresConfirmation commit renders a card — cancel_quote/
    // cancel_application/change_payment_option/request_cancellation had no
    // card (the P0-6 class, discovered while aligning schemas/descriptions).
    expect(CONFIRMABLE_TOOLS).toEqual([
      'sign_dnt', 'accept_quote', 'write_question_answer', 'modify_answer', 'sign_medical_declarations',
      'cancel_quote', 'cancel_application', 'change_payment_option', 'request_cancellation',
    ])
  })

  it('P2-15: the four previously cardless confirmable commits round-trip their tokens (+ material args)', () => {
    const cq = adaptAction(buildConfirmAction('cancel_quote', 'tok-7')!)
    expect(cq?.name).toBe('cancel_quote')
    expect(cq?.arguments).toEqual({ confirmToken: 'tok-7' })

    const ca = adaptAction(buildConfirmAction('cancel_application', 'tok-8', { reason: 'customer changed mind' })!)
    expect(ca?.name).toBe('cancel_application')
    expect(ca?.arguments).toMatchObject({ confirmToken: 'tok-8' })

    // change_payment_option: paymentOption is MATERIAL — must ride the round-trip
    const cp = adaptAction(buildConfirmAction('change_payment_option', 'tok-9', { paymentOption: 'quarterly' })!)
    expect(cp?.name).toBe('change_payment_option')
    expect(cp?.arguments).toEqual({ paymentOption: 'quarterly', confirmToken: 'tok-9' })

    const rc = adaptAction(buildConfirmAction('request_cancellation', 'tok-10')!)
    expect(rc?.name).toBe('request_cancellation')
    expect(rc?.arguments).toEqual({ confirmToken: 'tok-10' })
  })
  it('sign_medical_declarations round-trips the token (T6.D3 deviation — ONE card for the whole medical set)', () => {
    const action = buildConfirmAction('sign_medical_declarations', 'tok-6')
    expect(action).not.toBeNull()
    const tc = adaptAction(action!)
    expect(tc?.name).toBe('sign_medical_declarations')
    expect(tc?.arguments).toEqual({ confirmToken: 'tok-6' })
  })
  it('BD medical sensitive answers round-trip: write_question_answer confirm carries answer + code + token (P0-6, 2026-07-06)', () => {
    const action = buildConfirmAction('write_question_answer', 'tok-4', { answer: 'da', questionCode: 'BD_CANCER_HISTORY' })
    expect(action).not.toBeNull()
    const tc = adaptAction(action!)
    expect(tc?.name).toBe('write_question_answer')
    expect(tc?.arguments).toEqual({ answer: 'da', questionCode: 'BD_CANCER_HISTORY', confirmToken: 'tok-4' })
  })
  it('answer_question card clicks carry the questionCode so stale clicks hit the C1.9 mismatch guard (2026-07-06)', () => {
    const tc = adaptAction({ type: 'answer_question', payload: { answer: 'da', questionId: 'q1', questionCode: 'HEALTH_DECLARATION_CONFIRM', groupType: 'application' } })
    expect(tc?.name).toBe('write_question_answer')
    expect(tc?.arguments).toMatchObject({ answer: 'da', questionCode: 'HEALTH_DECLARATION_CONFIRM' })
  })
  it('modify_answer confirm carries code + newValue + token (P0-6)', () => {
    const action = buildConfirmAction('modify_answer', 'tok-5', { questionCode: 'BD_CANCER_HISTORY', newValue: 'nu' })
    expect(action).not.toBeNull()
    const tc = adaptAction(action!)
    expect(tc?.name).toBe('modify_answer')
    expect(tc?.arguments).toEqual({ questionCode: 'BD_CANCER_HISTORY', newValue: 'nu', confirmToken: 'tok-5' })
  })
})
