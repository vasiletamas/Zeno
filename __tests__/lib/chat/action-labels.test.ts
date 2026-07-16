/**
 * T22: reloaded history renders human interaction chips — never "[Action: …]".
 *
 * actionLabel derives a localized, PII-safe summary from the action object at
 * the route (the single writer of the synthesized user message); renderKind
 * classifies persisted content for MessageBubble (new prefix, legacy marker,
 * plain text).
 */
import { describe, it, expect } from 'vitest'
import {
  ACTION_MESSAGE_PREFIX,
  actionLabel,
  renderKind,
} from '@/lib/chat/action-labels'

describe('ACTION_MESSAGE_PREFIX', () => {
  it('is the ⟦action⟧ marker', () => {
    expect(ACTION_MESSAGE_PREFIX).toBe('⟦action⟧')
  })
})

describe('actionLabel — answers', () => {
  it('answer_question with payload.answer (ro/en)', () => {
    const action = { type: 'answer_question', payload: { answer: '35' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Răspuns: 35')
    expect(actionLabel(action, 'en')).toBe('✓ Answer: 35')
  })

  it('falls back to payload.value when payload.answer is absent', () => {
    const action = { type: 'answer_question', payload: { value: 'monthly' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Răspuns: monthly')
  })

  it('write_question_answer uses the same answer label', () => {
    const action = { type: 'write_question_answer', payload: { answer: 'Nu' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Răspuns: Nu')
  })

  it('modify_answer falls back to payload.newValue', () => {
    const action = { type: 'modify_answer', payload: { newValue: '70000', questionCode: 'BD_X' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Răspuns: 70000')
    expect(actionLabel(action, 'en')).toBe('✓ Answer: 70000')
  })

  it('joins MULTI_SELECT array answers with ", "', () => {
    const action = { type: 'answer_question', payload: { answer: ['sport', 'travel'] } }
    expect(actionLabel(action, 'ro')).toBe('✓ Răspuns: sport, travel')
    expect(actionLabel(action, 'en')).toBe('✓ Answer: sport, travel')
  })

  it('humanizes boolean-literal answers (the BOOLEAN card posts "true"/"false")', () => {
    expect(actionLabel({ type: 'answer_question', payload: { answer: 'true' } }, 'ro')).toBe('✓ Răspuns: Da')
    expect(actionLabel({ type: 'answer_question', payload: { answer: 'false' } }, 'ro')).toBe('✓ Răspuns: Nu')
    expect(actionLabel({ type: 'answer_question', payload: { answer: 'true' } }, 'en')).toBe('✓ Answer: Yes')
    expect(actionLabel({ type: 'answer_question', payload: { answer: 'false' } }, 'en')).toBe('✓ Answer: No')
  })

  it('renders the bare answer label when no answer value is present', () => {
    expect(actionLabel({ type: 'answer_question', payload: {} }, 'ro')).toBe('✓ Răspuns')
    expect(actionLabel({ type: 'answer_question' }, 'en')).toBe('✓ Answer')
  })
})

describe('actionLabel — signatures, quote, medical', () => {
  it.each([
    ['medical_batch', '✓ Declarații medicale completate', '✓ Medical declarations completed'],
    ['sign_dnt', '✓ Analiza de nevoi semnată', '✓ Needs analysis signed'],
    ['sign_medical_declarations', '✓ Declarații medicale semnate', '✓ Medical declarations signed'],
    ['accept_quote', '✓ Ofertă acceptată', '✓ Quote accepted'],
    ['cancel_quote', '✓ Ofertă anulată', '✓ Quote cancelled'],
  ])('%s', (type, ro, en) => {
    expect(actionLabel({ type, payload: {} }, 'ro')).toBe(ro)
    expect(actionLabel({ type, payload: {} }, 'en')).toBe(en)
  })
})

describe('actionLabel — submit_field (labels + masking)', () => {
  it('email is shown as-is', () => {
    const action = { type: 'submit_field', payload: { field: 'email', value: 'ana@example.com' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Email: ana@example.com')
    expect(actionLabel(action, 'en')).toBe('✓ Email: ana@example.com')
  })

  it('phone is masked to the last 3 digits', () => {
    const action = { type: 'submit_field', payload: { field: 'phone', value: '0740123607' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Telefon: ***607')
    expect(actionLabel(action, 'en')).toBe('✓ Phone: ***607')
  })

  it('cnp is masked to the first 3 characters', () => {
    const action = { type: 'submit_field', payload: { field: 'cnp', value: '1860601123456' } }
    expect(actionLabel(action, 'ro')).toBe('✓ CNP: 186**********')
    expect(actionLabel(action, 'en')).toBe('✓ CNP: 186**********')
  })

  it.each([
    ['name', 'Ana Pop', 'Nume', 'Name'],
    ['dateOfBirth', '1986-06-01', 'Data nașterii', 'Date of birth'],
    ['declaredAge', '39', 'Vârstă declarată', 'Declared age'],
    ['address', 'Str. Lungă 1', 'Adresă', 'Address'],
  ])('%s uses the localized field label', (field, value, ro, en) => {
    const action = { type: 'submit_field', payload: { field, value } }
    expect(actionLabel(action, 'ro')).toBe(`✓ ${ro}: ${value}`)
    expect(actionLabel(action, 'en')).toBe(`✓ ${en}: ${value}`)
  })

  it('unknown field falls back to the raw field name', () => {
    const action = { type: 'submit_field', payload: { field: 'iban', value: 'RO49...' } }
    expect(actionLabel(action, 'ro')).toBe('✓ iban: RO49...')
  })
})

describe('actionLabel — identity, documents, payment', () => {
  it('otp_submit NEVER leaks the code', () => {
    const action = { type: 'otp_submit', payload: { code: '123456' } }
    expect(actionLabel(action, 'ro')).toBe('✓ Cod de verificare introdus')
    expect(actionLabel(action, 'en')).toBe('✓ Verification code entered')
    expect(actionLabel(action, 'ro')).not.toContain('123456')
    expect(actionLabel(action, 'en')).not.toContain('123456')
  })

  it.each([
    ['otp_resend', '✓ Cod retrimis', '✓ Code resent'],
    ['document_uploaded', '✓ Document încărcat', '✓ Document uploaded'],
    ['payment_complete', '✓ Plată efectuată', '✓ Payment completed'],
  ])('%s', (type, ro, en) => {
    expect(actionLabel({ type, payload: {} }, 'ro')).toBe(ro)
    expect(actionLabel({ type, payload: {} }, 'en')).toBe(en)
  })
})

describe('actionLabel — coverage selection family', () => {
  it.each(['select_tier', 'select_level', 'select_coverage'])('%s', (type) => {
    expect(actionLabel({ type, payload: { tierCode: 'standard' } }, 'ro')).toBe('✓ Pachet selectat')
    expect(actionLabel({ type, payload: { tierCode: 'standard' } }, 'en')).toBe('✓ Package selected')
  })
})

describe('actionLabel — generic fallback', () => {
  it.each([
    'start_dnt',
    'set_application',
    'resume_application',
    'generate_quote',
    'open_acceptance',
    'definitely_not_a_registered_action',
  ])('%s falls back to the generic interaction label', (type) => {
    expect(actionLabel({ type, payload: {} }, 'ro')).toBe('✓ Interacțiune')
    expect(actionLabel({ type, payload: {} }, 'en')).toBe('✓ Interaction')
  })
})

describe('renderKind', () => {
  it('detects the new prefix and returns the label', () => {
    expect(renderKind('⟦action⟧✓ Răspuns: Da')).toEqual({ kind: 'action', label: '✓ Răspuns: Da' })
  })

  it('detects a prefixed English label', () => {
    expect(renderKind(`${ACTION_MESSAGE_PREFIX}✓ Quote accepted`)).toEqual({
      kind: 'action',
      label: '✓ Quote accepted',
    })
  })

  it('detects the legacy [Action: type] marker', () => {
    expect(renderKind('[Action: answer_question]')).toEqual({ kind: 'legacy_action' })
    expect(renderKind('[Action: sign_dnt]')).toEqual({ kind: 'legacy_action' })
  })

  it('detects the legacy confirm variant used by recorded sims', () => {
    expect(renderKind('[Action: confirm sign_dnt]')).toEqual({ kind: 'legacy_action' })
  })

  it('treats ordinary text as text', () => {
    expect(renderKind('Vreau o asigurare de viață')).toEqual({ kind: 'text' })
  })

  it('does NOT treat embedded or malformed markers as legacy', () => {
    expect(renderKind('am scris [Action: sign_dnt] in mesaj')).toEqual({ kind: 'text' })
    expect(renderKind('[Action: Sign_DNT]')).toEqual({ kind: 'text' })
    expect(renderKind('[Action:]')).toEqual({ kind: 'text' })
    expect(renderKind('')).toEqual({ kind: 'text' })
  })
})
