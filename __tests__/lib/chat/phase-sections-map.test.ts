import { describe, it, expect } from 'vitest'
import { getRequiredSectionsFor, formatDerivedBriefing } from '@/lib/chat/phase-sections-map'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from '../engines/snapshot-fixtures'
import { PHASES, APP_SUBPHASES } from '@/lib/engines/domain-types'

describe('getRequiredSectionsFor (A1 content-preserving mapping)', () => {
  it('DISCOVERY absorbs the old SELECTION extras', () => {
    const s = getRequiredSectionsFor('DISCOVERY', null)
    for (const k of ['capabilityManifest', 'customerContext', 'customerMemory', 'agentKnowledge', 'productContext', 'coachingBriefing']) expect(s).toContain(k)
  })
  it('APPLICATION/DNT inherits the old CONSENT payload', () => {
    expect(getRequiredSectionsFor('APPLICATION', 'DNT')).toContain('complianceGuidance')
  })
  it('APPLICATION/QUESTIONNAIRE keeps questionnaireContext + complianceGuidance', () => {
    const s = getRequiredSectionsFor('APPLICATION', 'QUESTIONNAIRE')
    expect(s).toContain('questionnaireContext'); expect(s).toContain('complianceGuidance')
  })
  it('is total over the full phase×subphase matrix (no throw, always includes situationalBriefing)', () => {
    for (const p of PHASES) for (const sub of [...APP_SUBPHASES, null]) {
      expect(getRequiredSectionsFor(p, p === 'APPLICATION' ? sub : null)).toContain('situationalBriefing')
    }
  })
  it('TARGET map: APPLICATION/DNT injects dntContext; PAYMENT injects paymentContext and NO coaching; POLICY injects policyContext', () => {
    expect(getRequiredSectionsFor('APPLICATION', 'DNT')).toEqual(expect.arrayContaining(['dntContext', 'complianceGuidance']))
    const pay = getRequiredSectionsFor('PAYMENT', null)
    expect(pay).toContain('paymentContext')
    expect(pay).not.toContain('coachingBriefing')
    expect(getRequiredSectionsFor('POLICY', null)).toContain('policyContext')
  })
  it('workflowInstructions is no longer always included (dead workflow machine — see inventory)', () => {
    expect(getRequiredSectionsFor('DISCOVERY', null)).not.toContain('workflowInstructions')
  })
  it('coaching is retired from the QUOTE surfaces (inventory row 7)', () => {
    expect(getRequiredSectionsFor('QUOTE', null)).not.toContain('coachingBriefing')
    expect(getRequiredSectionsFor('APPLICATION', 'QUOTE_GENERATION')).not.toContain('coachingBriefing')
  })
})

describe('formatDerivedBriefing (new vocabulary)', () => {
  it('renders phase, subphase and the engine nextBestAction', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Phase: APPLICATION/DNT')
    expect(text).toContain('Next best action:')
  })
  it('briefing renders per-stage facts: quote validity in QUOTE, payment status in PAYMENT', () => {
    const q = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false }, dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} }, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true }, quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false } }))
    expect(formatDerivedBriefing(q.state, q.actions)).toContain('Quote valid until: 2027-01-01')
    const p = deriveAndExpose(makeSnapshot({ acceptedQuote: { id: 'q', acceptedAt: null }, schedule: { exists: true, settled: false, nextDueAt: null, lastPaymentStatus: 'FAILED' } }))
    expect(formatDerivedBriefing(p.state, p.actions)).toContain('Payment status: FAILED')
  })
  it('briefing renders DNT remaining during APPLICATION/DNT', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} } }))
    expect(formatDerivedBriefing(r.state, r.actions)).toContain('DNT remaining: 3')
  })
  it('renders blocked actions with machine reason codes so the agent can explain a block', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false }, dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Blocked actions:')
    expect(text).toContain('generate_quote (requires_consent')
    expect(text).toContain('NEVER work around a blocked action')
  })
})
