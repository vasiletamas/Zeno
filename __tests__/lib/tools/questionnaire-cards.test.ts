import { describe, it, expect } from 'vitest'
import {
  CONDUCT_LINE,
  DNT_COMPLETION_MESSAGE,
  MEDICAL_COMPLETION_MESSAGE,
  APPLICATION_COMPLETION_MESSAGE,
  questionCard,
  savedMessage,
  rejectReemit,
  buildMedicalReviewCard,
} from '@/lib/tools/handlers/questionnaire-cards'

// T9/T12 clause 2 wording — pinned verbatim: the conduct instruction is
// server-owned, and diagnostics/prompt rules key off this exact sentence.
const EXPECTED_CONDUCT_LINE =
  'A question card is shown to the customer with all the options — NEVER list the options in prose (no "Opțiuni:" lists) and never repeat the question text; invite the customer to answer on the card in ONE short line.'

const NEXT = {
  id: 'q_1',
  code: 'HEALTH_DECLARATION_CONFIRM',
  text: { en: 'Do you confirm?', ro: 'Confirmați?' },
  helpText: { en: 'help', ro: 'ajutor' },
  type: 'BOOLEAN',
  options: [{ value: 'true', label: { en: 'Yes', ro: 'Da' } }],
  validationRules: { flags: [{ value: 'false', action: 'escalate' }] },
}

describe('CONDUCT_LINE', () => {
  it('is the canonical clause-2 wording', () => {
    expect(CONDUCT_LINE).toBe(EXPECTED_CONDUCT_LINE)
  })
})

describe('questionCard', () => {
  it('builds the DNT card byte-compatible with the historical dntQuestionCard emission', () => {
    const card = questionCard('dnt', NEXT, { answered: 2, total: 7 })
    expect(card).toEqual({
      type: 'show_question',
      payload: {
        question: {
          id: 'q_1',
          code: 'HEALTH_DECLARATION_CONFIRM',
          text: { en: 'Do you confirm?', ro: 'Confirmați?' },
          helpText: { en: 'help', ro: 'ajutor' },
          type: 'BOOLEAN',
          options: [{ value: 'true', label: { en: 'Yes', ro: 'Da' } }],
          validationRules: { flags: [{ value: 'false', action: 'escalate' }] },
        },
        progress: { answered: 2, total: 7 },
        groupType: 'dnt',
      },
    })
  })

  it('builds the application card with the SAME unified shape — validationRules included', () => {
    const card = questionCard('application', NEXT, { answered: 0, total: 7 })
    expect(card?.payload.groupType).toBe('application')
    expect((card?.payload.question as Record<string, unknown>).validationRules).toEqual(NEXT.validationRules)
  })

  it('normalizes progress to {answered,total} only (calculateProgress adds percentage)', () => {
    const card = questionCard('application', NEXT, { answered: 1, total: 4, percentage: 25 } as unknown as { answered: number; total: number })
    expect(card?.payload.progress).toEqual({ answered: 1, total: 4 })
  })

  it('returns undefined when there is no next question', () => {
    expect(questionCard('dnt', null, { answered: 7, total: 7 })).toBeUndefined()
  })

  it('coerces a missing helpText to null (raw rows always carry it; QuestionData may not)', () => {
    const { helpText: _omit, ...noHelp } = NEXT
    const card = questionCard('dnt', { ...noHelp, helpText: undefined }, { answered: 0, total: 1 })
    expect((card?.payload.question as Record<string, unknown>).helpText).toBeNull()
  })
})

describe('savedMessage', () => {
  it('dnt has-next keeps the Next-question-code prefix and typed fallback, embeds CONDUCT_LINE', () => {
    const msg = savedMessage('dnt', NEXT, { answered: 3, total: 7 })
    expect(msg).toBe(
      `Answer saved. Next question code: HEALTH_DECLARATION_CONFIRM. 4 remaining. ${EXPECTED_CONDUCT_LINE} If the customer types instead, call write_dnt_answer with questionCode "HEALTH_DECLARATION_CONFIRM".`,
    )
  })

  it('application has-next keeps the questions-remaining prefix, embeds CONDUCT_LINE', () => {
    const msg = savedMessage('application', NEXT, { answered: 3, total: 7 })
    expect(msg).toBe(`Answer saved. 4 questions remaining. ${EXPECTED_CONDUCT_LINE}`)
  })

  it('dnt completion says the review card is ALREADY shown and forbids prose confirmation / self-sign (T7 clause 5, pinned verbatim)', () => {
    expect(DNT_COMPLETION_MESSAGE).toBe(
      'All DNT questions answered. A review card with consent checkboxes and a Sign button is shown — do NOT ask for confirmation in prose and do NOT call sign_dnt yourself; invite the customer to review and sign on the card in ONE short line.',
    )
    expect(savedMessage('dnt', null, { answered: 7, total: 7 })).toBe(DNT_COMPLETION_MESSAGE)
  })

  it('application completion (no pending medical) drops the sign_medical sentence — T11: the card rides the commit, never the prose (pinned verbatim)', () => {
    expect(APPLICATION_COMPLETION_MESSAGE).toBe('Application questionnaire complete. Generate the quote.')
    expect(savedMessage('application', null, { answered: 7, total: 7 })).toBe(APPLICATION_COMPLETION_MESSAGE)
  })

  it('medical completion says the review card is ALREADY shown, forbids self-sign AND referencing cards no tool emitted (T11 clauses 5+7, pinned verbatim)', () => {
    expect(MEDICAL_COMPLETION_MESSAGE).toBe(
      'Application questionnaire complete. A medical-declarations review card with a Sign button is shown to the customer — do NOT call sign_medical_declarations yourself and do NOT reference any card unless a tool result THIS turn emitted one; invite them to sign in ONE short line.',
    )
  })
})

describe('buildMedicalReviewCard', () => {
  const state = {
    declarations: [
      { code: 'BD_CANCER_HISTORY', text: { en: 'Cancer?', ro: 'Cancer?' }, value: 'false' },
      { code: 'BD_TRANSPLANT', text: { en: 'Transplant?', ro: 'Transplant?' }, value: 'true' },
    ],
  }

  it('builds show_medical_review over the loader state — question text rides localized, boolean values gain Da/Nu labels', () => {
    expect(buildMedicalReviewCard('app_1', state)).toEqual({
      type: 'show_medical_review',
      payload: {
        applicationId: 'app_1',
        declarations: [
          { code: 'BD_CANCER_HISTORY', question: { en: 'Cancer?', ro: 'Cancer?' }, value: 'false', valueLabel: { en: 'No', ro: 'Nu' } },
          { code: 'BD_TRANSPLANT', question: { en: 'Transplant?', ro: 'Transplant?' }, value: 'true', valueLabel: { en: 'Yes', ro: 'Da' } },
        ],
      },
    })
  })

  it('a non-boolean value keeps a null valueLabel (the card falls back to the raw value)', () => {
    const card = buildMedicalReviewCard('app_1', { declarations: [{ code: 'X', text: { en: 'x', ro: 'x' }, value: 'other' }] })
    expect(card.payload.declarations[0].valueLabel).toBeNull()
  })
})

describe('rejectReemit', () => {
  const card = { type: 'show_question' as const, payload: { groupType: 'dnt' } }

  it('threads the card through data._uiAction (the rejection-envelope escape hatch)', () => {
    expect(rejectReemit({ hint: 'x' }, card)).toEqual({ hint: 'x', _uiAction: card })
  })

  it('tolerates undefined data', () => {
    expect(rejectReemit(undefined, card)).toEqual({ _uiAction: card })
  })

  it('omits _uiAction entirely when there is no card to re-emit', () => {
    expect(rejectReemit({ hint: 'x' }, undefined)).toEqual({ hint: 'x' })
    expect(rejectReemit(undefined, undefined)).toEqual({})
  })
})
