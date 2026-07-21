import { describe, it, expect } from 'vitest'
import {
  cardView,
  cardKeyForUiAction,
  cardKeyForAction,
  questionKeyFor,
  QUESTION_BATCH_KEY,
  type ActiveCardEntry,
} from '@/lib/chat/card-view'

describe('card-view (spec 2026-07-20 §2 — ✓ can never lie)', () => {
  const cardsState: ActiveCardEntry[] = [
    { key: 'data_field:phone', status: 'active', hint: 'x' },
    { key: 'otp:email', status: 'expired', hint: 'x' },
    { key: 'data_field:email', status: 'deferred', hint: 'x' },
  ]

  it('key in set: active→interactive, expired→inert_expired (resend enabled), deferred→inert_released', () => {
    expect(cardView('data_field:phone', cardsState, null)).toEqual({ status: 'interactive' })
    expect(cardView('otp:email', cardsState, null)).toEqual({ status: 'inert_expired' })
    expect(cardView('data_field:email', cardsState, null)).toEqual({ status: 'inert_released' })
  })

  it('key absent from set → inert_resolved (absence = resolved/superseded)', () => {
    expect(cardView('question:BD_1', cardsState, null)).toEqual({ status: 'inert_resolved' })
  })

  it('null key (presentation card) → inert_resolved', () => {
    expect(cardView(null, cardsState, null)).toEqual({ status: 'inert_resolved' })
  })

  it('submitting key overrides while in flight', () => {
    expect(cardView('data_field:phone', cardsState, 'data_field:phone')).toEqual({ status: 'submitting' })
    // a DIFFERENT in-flight key does not lock this card
    expect(cardView('data_field:phone', cardsState, 'otp:email')).toEqual({ status: 'interactive' })
  })

  it('a submitting key already absent from the set still renders submitting (in-flight wins)', () => {
    expect(cardView('question:BD_1', cardsState, 'question:BD_1')).toEqual({ status: 'submitting' })
  })
})

describe('cardKeyForUiAction — rendered cards map to semantic keys', () => {
  it('maps the input-card families', () => {
    expect(cardKeyForUiAction({ type: 'show_data_field', payload: { field: 'phone' } })).toBe('data_field:phone')
    expect(cardKeyForUiAction({ type: 'show_otp_entry', payload: { channel: 'email', target: 'a@b.ro' } })).toBe('otp:email')
    // real questionCard() payload nests the code under payload.question
    expect(cardKeyForUiAction({ type: 'show_question', payload: { question: { code: 'DNT_TRAVEL' }, progress: { answered: 0, total: 5 }, groupType: 'dnt' } })).toBe('question:DNT_TRAVEL')
    // a top-level code wins when present
    expect(cardKeyForUiAction({ type: 'show_question', payload: { code: 'BD_CANCER_HISTORY', question: { code: 'IGNORED' } } })).toBe('question:BD_CANCER_HISTORY')
  })

  it('question cards without a code fall back to the shared batch key', () => {
    // buildMedicalBatchCard payload: { applicationId, conditions, progress } — no code
    expect(cardKeyForUiAction({ type: 'show_medical_batch', payload: { applicationId: 'app1', conditions: [], progress: { answered: 0, total: 6 } } })).toBe(QUESTION_BATCH_KEY)
    expect(cardKeyForUiAction({ type: 'show_question', payload: { question: { code: null } } })).toBe(QUESTION_BATCH_KEY)
  })

  it('presentation cards have no key in v1', () => {
    expect(cardKeyForUiAction({ type: 'show_quote', payload: {} })).toBeNull()
    expect(cardKeyForUiAction({ type: 'show_product_cards', payload: {} })).toBeNull()
    expect(cardKeyForUiAction({ type: 'confirm_required', payload: { tool: 'sign_dnt' } })).toBeNull()
    expect(cardKeyForUiAction({ type: 'show_dnt_review', payload: {} })).toBeNull()
  })

  it('malformed payloads never throw — they yield null', () => {
    expect(cardKeyForUiAction({ type: 'show_data_field', payload: {} })).toBeNull()
    expect(cardKeyForUiAction({ type: 'show_otp_entry', payload: {} })).toBeNull()
  })
})

describe('cardKeyForAction — submitted actions map to semantic keys (REAL adapter types)', () => {
  it('submit_field → data_field key', () => {
    expect(cardKeyForAction({ type: 'submit_field', payload: { field: 'phone', value: '0735226607' } })).toBe('data_field:phone')
  })

  it('otp_submit / otp_resend → otp key (channel from payload, email fallback for pre-threading cards)', () => {
    expect(cardKeyForAction({ type: 'otp_submit', payload: { code: '123456', channel: 'sms' } })).toBe('otp:sms')
    // legacy submit payloads carry only { code } — buildOtpSubmitAction pre-channel-threading
    expect(cardKeyForAction({ type: 'otp_submit', payload: { code: '123456' } })).toBe('otp:email')
    expect(cardKeyForAction({ type: 'otp_resend', payload: { channel: 'email', target: 'a@b.ro' } })).toBe('otp:email')
  })

  it('answer_question (+ legacy answer_dnt) → question key from questionCode', () => {
    // rich-content posts { answer, questionId, questionCode, groupType }
    expect(cardKeyForAction({ type: 'answer_question', payload: { answer: 'true', questionId: 'q1', questionCode: 'DNT_TRAVEL', groupType: 'dnt' } })).toBe('question:DNT_TRAVEL')
    expect(cardKeyForAction({ type: 'answer_dnt', payload: { questionCode: 'DNT_TRAVEL', value: 'true' } })).toBe('question:DNT_TRAVEL')
    // question.code is string|null — a null code falls back to the batch key
    expect(cardKeyForAction({ type: 'answer_question', payload: { answer: 'x', questionCode: null, groupType: 'application' } })).toBe(QUESTION_BATCH_KEY)
  })

  it('medical_batch (the REAL type — not submit_medical_batch) → shared batch key', () => {
    expect(cardKeyForAction({ type: 'medical_batch', payload: { answers: { BD_1: 'false' } } })).toBe(QUESTION_BATCH_KEY)
  })

  it('question confirm round-trips (write_question_answer / modify_answer) target the question key', () => {
    expect(cardKeyForAction({ type: 'write_question_answer', payload: { answer: 'true', questionCode: 'BD_CANCER_HISTORY', confirmToken: 't' } })).toBe('question:BD_CANCER_HISTORY')
    expect(cardKeyForAction({ type: 'modify_answer', payload: { questionCode: 'BD_CANCER_HISTORY', newValue: 'false' } })).toBe('question:BD_CANCER_HISTORY')
  })

  it('non-input actions have no key', () => {
    expect(cardKeyForAction({ type: 'select_tier', payload: { tierCode: 'basic', levelCode: 'l1' } })).toBeNull()
    expect(cardKeyForAction({ type: 'accept_quote', payload: {} })).toBeNull()
    expect(cardKeyForAction({ type: 'open_acceptance', payload: {} })).toBeNull()
    expect(cardKeyForAction({ type: 'sign_dnt', payload: {} })).toBeNull()
    expect(cardKeyForAction({ type: 'payment_complete', payload: {} })).toBeNull()
  })
})

describe('QUESTION_BATCH_KEY — ONE shared constant for the code-less question card', () => {
  it('is the literal the server derivation and the client mappers share', () => {
    expect(QUESTION_BATCH_KEY).toBe('question:batch')
  })

  it('questionKeyFor builds question keys with the batch fallback (?? semantics: null/undefined only)', () => {
    expect(questionKeyFor('BD_1')).toBe('question:BD_1')
    expect(questionKeyFor(null)).toBe(QUESTION_BATCH_KEY)
    expect(questionKeyFor(undefined)).toBe(QUESTION_BATCH_KEY)
  })
})
