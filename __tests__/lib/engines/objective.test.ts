/**
 * B1 (plan 2026-07-06, F1): the engine derives a structured funnel objective
 * — goal + how it is achievable now + which blocked precondition stands in
 * the way — instead of only the imperative "call X" hint. The D5 failure
 * class (model obeys a wrong hint while a verification code is pending)
 * dies here: when the furthest funnel action is BLOCKED, the objective says
 * so with the blocking reason, and the briefing renders facts, not commands.
 */
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

const SIGNED_DNT = {
  signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z',
  coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false,
  latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {},
}

describe('objective derivation', () => {
  it('D5 shape: issued quote + unverified identity → goal quote_acceptance, not achievable, requires_identity precondition', () => {
    const r = deriveAndExpose(makeSnapshot({
      application: { id: 'a', status: 'OPEN', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: true },
      dnt: SIGNED_DNT,
      consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false },
      identity: { tier: 'anonymous', fields: {}, verifiedChannels: [], pendingChallenge: { channel: 'email' } },
    }))

    expect(r.state.objective.goal).toBe('quote_acceptance')
    expect(r.state.objective.achievableNow).toBeNull()
    expect(r.state.objective.missingPreconditions).toHaveLength(1)
    expect(r.state.objective.missingPreconditions[0]).toMatchObject({
      action: 'accept_quote',
      reason: 'requires_identity',
    })
  })

  it('active DNT session with pending question → goal needs_analysis, achievable via write_dnt_answer', () => {
    const r = deriveAndExpose(makeSnapshot({
      dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 1, totalCount: 5, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 1, sessionTotal: 5, facts: {}, pendingCode: 'DNT_AGE' },
    }))

    expect(r.state.objective.goal).toBe('needs_analysis')
    expect(r.state.objective.achievableNow).toBe('write_dnt_answer')
    expect(r.state.objective.missingPreconditions).toEqual([])
  })

  it('bare discovery → goal discovery, achievable via set_candidate_product', () => {
    const r = deriveAndExpose(makeSnapshot({ product: null }))
    expect(r.state.objective.goal).toBe('discovery')
    expect(r.state.objective.achievableNow).toBe('set_candidate_product')
  })

  it('INVARIANT: achievableNow, when set, names an available action', () => {
    const snapshots = [
      makeSnapshot(),
      makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false } }),
      makeSnapshot({ acceptedQuote: { id: 'q', acceptedAt: null }, schedule: { exists: true, settled: false, nextDueAt: '2026-08-01T00:00:00.000Z', lastPaymentStatus: null } }),
    ]
    for (const s of snapshots) {
      const r = deriveAndExpose(s)
      if (r.state.objective.achievableNow) {
        expect(r.actions.available).toContain(r.state.objective.achievableNow)
      }
    }
  })

  it('nextBestAction stays populated for compat (monitors, get_current_state)', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(typeof r.state.nextBestAction).toBe('string')
    expect(r.state.nextBestAction.length).toBeGreaterThan(0)
  })
})
