/**
 * T8 (design 2026-07-15 §1/§5): set_purchase_intent is exposed in every
 * selling phase — DISCOVERY through PAYMENT — and NOT in POLICY (post-sale,
 * no selling). The derived state carries the snapshot's `intent` slice
 * verbatim so get_current_state and the briefing read one source.
 */
import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'
import type { DomainSnapshot } from '@/lib/engines/domain-types'

const APP: NonNullable<DomainSnapshot['application']> = { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false }
const SIGNED_DNT: DomainSnapshot['dnt'] = { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} }

describe('set_purchase_intent exposure (T8)', () => {
  it('exposed in DISCOVERY', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(r.state.phase).toBe('DISCOVERY')
    expect(r.actions.available).toContain('set_purchase_intent')
  })
  it('exposed in APPLICATION', () => {
    const r = deriveAndExpose(makeSnapshot({ application: APP }))
    expect(r.state.phase).toBe('APPLICATION')
    expect(r.actions.available).toContain('set_purchase_intent')
  })
  it('exposed in QUOTE', () => {
    const r = deriveAndExpose(makeSnapshot({
      application: { ...APP, answeredCount: 6, missingCodes: [], frozen: true }, dnt: SIGNED_DNT,
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false },
    }))
    expect(r.state.phase).toBe('QUOTE')
    expect(r.actions.available).toContain('set_purchase_intent')
  })
  it('exposed in PAYMENT', () => {
    const r = deriveAndExpose(makeSnapshot({ acceptedQuote: { id: 'q', acceptedAt: null }, schedule: { exists: true, settled: false, nextDueAt: '2026-08-01T00:00:00.000Z', lastPaymentStatus: null } }))
    expect(r.state.phase).toBe('PAYMENT')
    expect(r.actions.available).toContain('set_purchase_intent')
  })
  it('NOT exposed in POLICY (post-sale — the sale is closed, no selling)', () => {
    const r = deriveAndExpose(makeSnapshot({ policy: { id: 'pol', status: 'ACTIVE' } }))
    expect(r.state.phase).toBe('POLICY')
    expect(r.actions.available).not.toContain('set_purchase_intent')
  })
  it('the derived state carries the snapshot intent slice verbatim; null when absent', () => {
    const intent = { goal: 'purchase', productCode: 'protect', config: { tier: 'standard' }, capturedAt: '2026-07-15T00:00:00.000Z', sameSession: true, status: 'active' }
    expect(deriveAndExpose(makeSnapshot({ intent })).state.intent).toEqual(intent)
    expect(deriveAndExpose(makeSnapshot()).state.intent).toBeNull()
  })
})
