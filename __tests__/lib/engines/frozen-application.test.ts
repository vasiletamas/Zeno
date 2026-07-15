import { describe, it, expect } from 'vitest'
import { mutationBlockedReason, MUTATING_APPLICATION_ACTIONS } from '@/lib/engines/frozen-application'

describe('frozen-application predicate (D1.7)', () => {
  const frozen = { frozenAt: new Date(), quoteExists: true }
  const open = { frozenAt: null, quoteExists: false }

  it('blocks every selection/answer mutating action once frozen or once a quote exists in any state', () => {
    for (const action of MUTATING_APPLICATION_ACTIONS) {
      expect(mutationBlockedReason(frozen, action)).toBe('application_frozen')
      expect(mutationBlockedReason({ frozenAt: null, quoteExists: true }, action)).toBe('application_frozen')
      expect(mutationBlockedReason({ frozenAt: new Date(), quoteExists: false }, action)).toBe('application_frozen')
      expect(mutationBlockedReason(open, action)).toBeNull()
    }
  })

  it('never blocks non-mutating actions, frozen or not', () => {
    for (const action of ['generate_quote', 'cancel_quote', 'get_quote_info', 'resume_application']) {
      expect(mutationBlockedReason(frozen, action)).toBeNull()
    }
  })

  it('covers select_coverage, modify_answer, set_answer, write_question_answer', () => {
    expect(MUTATING_APPLICATION_ACTIONS).toEqual(
      expect.arrayContaining(['select_coverage', 'modify_answer', 'set_answer', 'write_question_answer']),
    )
  })
})
