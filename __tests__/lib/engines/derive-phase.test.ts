import { describe, it, expect } from 'vitest'
import { derivePhase } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

const openApp = { id: 'app-1', status: 'OPEN' as const, tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'] }
const validDnt = { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} }

describe('derivePhase — pinned #10 table', () => {
  it('DISCOVERY: no open application', () => {
    expect(derivePhase(makeSnapshot())).toEqual({ phase: 'DISCOVERY', subphase: null })
  })
  it('APPLICATION/DNT: open app + no valid DNT covering the product type', () => {
    expect(derivePhase(makeSnapshot({ application: openApp }))).toEqual({ phase: 'APPLICATION', subphase: 'DNT' })
  })
  it('APPLICATION/DNT also when the DNT is signed but expired', () => {
    const s = makeSnapshot({ application: openApp, dnt: { ...validDnt, valid: false, validUntil: '2024-01-01T00:00:00.000Z' } })
    expect(derivePhase(s)).toEqual({ phase: 'APPLICATION', subphase: 'DNT' })
  })
  it('APPLICATION/QUESTIONNAIRE: valid DNT + answers incomplete (valid-DNT returners skip DNT by predicate)', () => {
    expect(derivePhase(makeSnapshot({ application: openApp, dnt: validDnt }))).toEqual({ phase: 'APPLICATION', subphase: 'QUESTIONNAIRE' })
  })
  it('APPLICATION/QUOTE_GENERATION: complete, no issued quote (selection incompleteness is NOT a subphase)', () => {
    const done = { ...openApp, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [] }
    expect(derivePhase(makeSnapshot({ application: done, dnt: validDnt }))).toEqual({ phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' })
  })
  it('QUOTE: an issued, unexpired quote exists', () => {
    const done = { ...openApp, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [] }
    const s = makeSnapshot({ application: done, dnt: validDnt, quote: { id: 'q1', status: 'DRAFT', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false } })
    expect(derivePhase(s)).toEqual({ phase: 'QUOTE', subphase: null })
  })
  it('expired issued quote falls back to QUOTE_GENERATION (regenerate-loop killed)', () => {
    const done = { ...openApp, status: 'COMPLETED' as const, answeredCount: 6, missingCodes: [] }
    const s = makeSnapshot({ application: done, dnt: validDnt, quote: { id: 'q1', status: 'DRAFT', premiumAnnual: 500, validUntil: '2024-01-01T00:00:00.000Z', expired: true } })
    expect(derivePhase(s)).toEqual({ phase: 'APPLICATION', subphase: 'QUOTE_GENERATION' })
  })
  it('PAYMENT: accepted quote + schedule exists, no Policy row', () => {
    const s = makeSnapshot({ acceptedQuote: { id: 'q1', acceptedAt: '2026-06-01T00:00:00.000Z' }, schedule: { exists: true, settled: false, nextDueAt: null, lastPaymentStatus: null } })
    expect(derivePhase(s)).toEqual({ phase: 'PAYMENT', subphase: null })
  })
  it('POLICY: a Policy row exists', () => {
    const s = makeSnapshot({ policy: { id: 'pol1', status: 'PENDING_SUBMISSION' } })
    expect(derivePhase(s)).toEqual({ phase: 'POLICY', subphase: null })
  })
})
