import { describe, it, expect } from 'vitest'
import { deriveOpenItems } from '@/lib/engines/open-items'
import { makeSnapshot } from './snapshot-fixtures'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import type { DerivedStateV3 } from '@/lib/engines/domain-types'
import type { ExposedActions } from '@/lib/engines/open-items'

const NOW = new Date('2026-06-12T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (t: number) => new Date(t).toISOString()

/** Pure over literals (T12.D3): a minimal DerivedStateV3 with real slice shapes. */
function state(partial: Partial<DerivedStateV3>): DerivedStateV3 {
  const base = deriveAndExpose(makeSnapshot({})).state
  return { ...base, ...partial }
}

describe('deriveOpenItems (E4.2 — M2 pinned contract)', () => {
  it('surfaces an issued-unaccepted-unexpired quote with nextAction accept_quote when exposed', () => {
    const s = state({ quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 190, validUntil: iso(NOW.getTime() + 10 * DAY), expired: false, createdAt: iso(NOW.getTime() - 2 * DAY) } })
    const actions: ExposedActions = { available: ['accept_quote', 'get_quote_info', 'escalate_to_human'], blocked: [] }
    const items = deriveOpenItems(s, actions, NOW)
    expect(items).toContainEqual({ kind: 'quote', refId: 'q1', age: 2, nextAction: 'accept_quote' })
  })

  it('NEVER returns a nextAction outside actions.available — falls back to the escalation floor', () => {
    const s = state({ quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 190, validUntil: iso(NOW.getTime() + 1 * DAY), expired: false, createdAt: iso(NOW.getTime() - 1 * DAY) } })
    const actions: ExposedActions = { available: ['escalate_to_human'], blocked: [{ action: 'accept_quote', reason: 'requires_identity' }] }
    const items = deriveOpenItems(s, actions, NOW)
    expect(items[0].nextAction).toBe('escalate_to_human')
    for (const item of items) expect(actions.available).toContain(item.nextAction)
  })

  it('covers all five kinds: application, quote, installment, dnt_expiring, policy_in_progress', () => {
    const s = state({
      application: { id: 'a1', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 5, missingCodes: [], frozen: false, createdAt: iso(NOW.getTime() - 3 * DAY) },
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 190, validUntil: iso(NOW.getTime() + 5 * DAY), expired: false, createdAt: iso(NOW.getTime() - 2 * DAY) },
      schedule: { exists: true, settled: false, nextDueAt: iso(NOW.getTime() - 1 * DAY), lastPaymentStatus: null, capturedCount: 0, id: 's1' },
      dnt: {
        signed: true, valid: true, validUntil: iso(NOW.getTime() + 5 * DAY), coversProductTypes: ['LIFE'], answeredCount: 0, totalCount: 0, sessionActive: false,
        latest: { id: 'd1', status: 'ACTIVE', signedAt: iso(NOW.getTime() - 360 * DAY), validUntil: iso(NOW.getTime() + 5 * DAY), productTypesCovered: ['LIFE'] },
        activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {},
      },
      policy: { id: 'p1', status: 'PENDING_SUBMISSION', freeLookEndsAt: null, createdAt: iso(NOW.getTime() - 1 * DAY) },
    })
    const actions: ExposedActions = { available: ['write_question_answer', 'accept_quote', 'ensure_payment_session', 'open_dnt_session', 'get_policy_info', 'escalate_to_human'], blocked: [] }
    const kinds = deriveOpenItems(s, actions, NOW).map((i) => i.kind).sort()
    expect(kinds).toEqual(['application', 'dnt_expiring', 'installment', 'policy_in_progress', 'quote'])
  })

  it('expired quotes and settled schedules are not open items', () => {
    const s = state({
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 190, validUntil: iso(NOW.getTime() - 1 * DAY), expired: true, createdAt: iso(NOW.getTime() - 40 * DAY) },
      schedule: { exists: true, settled: true, nextDueAt: null, lastPaymentStatus: null, capturedCount: 4, id: 's1' },
    })
    expect(deriveOpenItems(s, { available: ['escalate_to_human'], blocked: [] }, NOW)).toHaveLength(0)
  })

  it('a DNT far from expiry is not an open item', () => {
    const s = state({
      dnt: {
        signed: true, valid: true, validUntil: iso(NOW.getTime() + 300 * DAY), coversProductTypes: ['LIFE'], answeredCount: 0, totalCount: 0, sessionActive: false,
        latest: { id: 'd1', status: 'ACTIVE', signedAt: iso(NOW.getTime() - 65 * DAY), validUntil: iso(NOW.getTime() + 300 * DAY), productTypesCovered: ['LIFE'] },
        activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {},
      },
    })
    expect(deriveOpenItems(s, { available: ['escalate_to_human'], blocked: [] }, NOW)).toHaveLength(0)
  })
})
