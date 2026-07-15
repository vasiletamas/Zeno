import { describe, it, expect } from 'vitest'
import { loadDntContext, loadPaymentContext, loadPolicyContext } from '@/lib/chat/context-loaders'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

describe('new (phase,subphase) sections', () => {
  it('dntContext renders DNT progress + consent status during APPLICATION/DNT', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} } }))
    const text = loadDntContext(r.state)
    expect(text).toContain('DNT progress: 2/5')
    expect(text).toContain('GDPR consent: missing')
  })
  it('paymentContext renders schedule facts and contains NO sales coaching', () => {
    const r = deriveAndExpose(makeSnapshot({ acceptedQuote: { id: 'q', acceptedAt: '2026-06-01T00:00:00.000Z' }, schedule: { exists: true, settled: false, nextDueAt: '2026-07-01T00:00:00.000Z', lastPaymentStatus: 'FAILED' } }))
    const text = loadPaymentContext(r.state)
    expect(text).toContain('Last payment status: FAILED')
    expect(text?.toLowerCase()).not.toContain('playbook')
  })
  it('policyContext renders policy status; engine-gated language rule included (never claim in-force before ACTIVE)', () => {
    const r = deriveAndExpose(makeSnapshot({ policy: { id: 'p', status: 'PENDING_SUBMISSION' } }))
    const text = loadPolicyContext(r.state)
    expect(text).toContain('Policy status: PENDING_SUBMISSION')
    expect(text).toContain('never describe the policy as active or in force')
  })
  it('dntContext renders during DISCOVERY when a session is active (pre-application flow) and carries the pending code', () => {
    const r = deriveAndExpose(makeSnapshot({ application: null, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 1, totalCount: 10, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 1, sessionTotal: 10, facts: {}, pendingCode: 'DNT_MARKETING_CONSENT' } }))
    expect(r.state.phase).toBe('DISCOVERY')
    const text = loadDntContext(r.state)
    expect(text).toContain('DNT progress: 1/10')
    expect(text).toContain('DNT_MARKETING_CONSENT')
  })
  it('dntContext carries the anti-fabrication rule (2026-07-06: model invented family size "2" after five bare "da" replies)', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 2, sessionTotal: 5, facts: {}, pendingCode: 'DNT_FAMILY_SIZE' } }))
    const text = loadDntContext(r.state)
    expect(text).toContain('NEVER call write_dnt_answer with a value the customer did not explicitly state')
  })
  it('renderers return null outside their phase', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(loadDntContext(r.state)).toBeNull()
    expect(loadPaymentContext(r.state)).toBeNull()
    expect(loadPolicyContext(r.state)).toBeNull()
  })
  it('dntContext: the card collects, the agent narrates (Task 2.2, D1) — no prose option enumeration, typed answers map to exact option values', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 2, sessionTotal: 5, facts: {}, pendingCode: 'DNT_FAMILY_SIZE' } }))
    const text = loadDntContext(r.state)
    expect(text).toMatch(/NEVER enumerate the options in prose/i)
    expect(text).toContain('Opțiuni:')  // named as the forbidden pattern
    expect(text).toMatch(/invite the customer to tap/i)
    expect(text).toMatch(/map it to the EXACT option value/i)
    expect(text).toMatch(/NEVER pass raw free text/i)
  })
})
