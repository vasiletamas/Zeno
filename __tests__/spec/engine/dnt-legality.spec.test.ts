import { describe, it, expect } from 'vitest'
import { spec } from '@/lib/spec/registry'
import { toToolName } from '@/lib/spec/operations-map'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot, OPEN_APP, VALID_DNT, ACTIVE_SESSION_DNT } from '../helpers/spec-snapshots'

describe('Feature: DNT — needs analysis, session, and consent gate (pinned #12 predicates)', () => {
  it(spec('dnt/valid-dnt-lets-questionnaire-begin') + ' questionnaire opens, no DNT tools offered', () => {
    const { state, actions } = deriveAndExpose(makeSnapshot({ application: OPEN_APP, dnt: VALID_DNT }))
    expect(state.subphase).toBe('QUESTIONNAIRE')
    expect(actions.available).not.toContain(toToolName('open_dnt_session'))
    expect(actions.available).not.toContain(toToolName('sign_dnt'))
    expect(actions.available).toContain(toToolName('write_question_answer'))
  })

  it(spec('dnt/active-session-resumed-not-restarted') + ' next-question read available, open blocked', () => {
    const { actions } = deriveAndExpose(makeSnapshot({ application: OPEN_APP, dnt: ACTIVE_SESSION_DNT }))
    expect(actions.available).toContain(toToolName('get_dnt_next_question'))
    expect(actions.available).not.toContain(toToolName('open_dnt_session'))
  })

  it(spec('dnt/no-valid-dnt-starts-new-session') + ' questionnaire gated requires_consent, open available', () => {
    const { state, actions } = deriveAndExpose(makeSnapshot({ application: OPEN_APP }))
    expect(state.subphase).toBe('DNT')
    expect(actions.available).toContain(toToolName('open_dnt_session'))
    expect(actions.blocked.find((b) => b.action === toToolName('write_question_answer'))?.reason).toBe('requires_consent')
  })

  it(spec('dnt/start-refuses-second-active-session') + ' blocked carrying the active session id', () => {
    const { actions } = deriveAndExpose(makeSnapshot({ application: OPEN_APP, dnt: ACTIVE_SESSION_DNT }))
    const block = actions.blocked.find((b) => b.action === toToolName('start_dnt_session'))
    expect(block?.reason).toBe('dnt_session_already_active')
    expect(block?.params).toEqual({ activeSessionId: 'ds-1' })
  })

  it(spec('dnt/last-answer-returns-finish-signal') + ' finished session exposes sign_dnt, no further answers', () => {
    const finished = { ...ACTIVE_SESSION_DNT, sessionAnswered: 5, sessionTotal: 5 }
    const { actions } = deriveAndExpose(makeSnapshot({ application: OPEN_APP, dnt: finished }))
    expect(actions.available).toContain(toToolName('sign_dnt'))
    expect(actions.available).not.toContain(toToolName('write_dnt_answer'))
  })

  it(spec('dnt/preview-form-without-session') + ' get_dnt_questions readable with product in focus, no session', () => {
    const { actions } = deriveAndExpose(makeSnapshot())
    expect(actions.available).toContain(toToolName('get_dnt_questions'))
    expect(actions.available).not.toContain(toToolName('write_dnt_answer'))
  })

  it(spec('dnt/dnt-not-covering-product-triggers-fresh-session') + ' open offered for the product in focus', () => {
    const notCovering = {
      ...VALID_DNT,
      coversProductTypes: [],
      latest: { ...VALID_DNT.latest!, productTypesCovered: [] },
    }
    const { actions } = deriveAndExpose(makeSnapshot({ application: OPEN_APP, dnt: notCovering }))
    expect(actions.available).toContain(toToolName('open_dnt_session'))
  })

  it(spec('dnt/consent-withdrawn-halts-processing') + ' every non-exempt commit blocked gdpr_processing_withdrawn', () => {
    const { actions } = deriveAndExpose(makeSnapshot({
      application: OPEN_APP, dnt: VALID_DNT,
      consents: { gdprProcessing: false, aiDisclosure: true, marketing: false, gdprWithdrawn: true, hasAnyEvents: true },
    }))
    const halted = actions.blocked.filter((b) => b.reason === 'gdpr_processing_withdrawn').map((b) => b.action)
    expect(halted).toContain(toToolName('write_question_answer'))
    expect(halted).toContain(toToolName('set_candidate_product'))
    // the exempt escape hatches stay live
    expect(actions.available).toContain(toToolName('escalate_to_human'))
    expect(actions.available).toContain(toToolName('withdraw_consent'))
  })
})
