import { describe, it, expect } from 'vitest'
import { loadDntContext, loadPaymentContext, loadPolicyContext } from '@/lib/chat/context-loaders'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'

describe('new (phase,subphase) sections', () => {
  it('dntContext renders DNT progress + consent status during APPLICATION/DNT', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'] }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0 } }))
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
  it('renderers return null outside their phase', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(loadDntContext(r.state)).toBeNull()
    expect(loadPaymentContext(r.state)).toBeNull()
    expect(loadPolicyContext(r.state)).toBeNull()
  })
})
