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
  it('memory survives the phase transition (Task 3.3, D3): customerMemory rides APPLICATION subphases and QUOTE, not just DISCOVERY', () => {
    expect(getRequiredSectionsFor('APPLICATION', 'DNT')).toContain('customerMemory')
    expect(getRequiredSectionsFor('APPLICATION', 'QUESTIONNAIRE')).toContain('customerMemory')
    expect(getRequiredSectionsFor('APPLICATION', 'QUOTE_GENERATION')).toContain('customerMemory')
    expect(getRequiredSectionsFor('QUOTE', null)).toContain('customerMemory')
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
  // B1 (plan 2026-07-06): the briefing states the objective as facts, never
  // as a command — "Next best action: call X" trained the model to obey
  // wrong engine hints (D5 class).
  it('renders phase, subphase and the funnel objective — never the imperative hint', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Phase: APPLICATION/DNT')
    expect(text).toContain('Open objective:')
    expect(text).not.toContain('Next best action:')
  })
  it('blocked objective renders the missing precondition with its reason (D5 class)', () => {
    const r = deriveAndExpose(makeSnapshot({
      application: { id: 'a', status: 'OPEN', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: true },
      dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
      consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false },
      identity: { tier: 'anonymous', fields: {}, verifiedChannels: [], pendingChallenge: { channel: 'email' } },
    }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Open objective:')
    expect(text).toContain('accept_quote is blocked: requires_identity')
    expect(text).toContain('Resolve this precondition first')
  })
  it('achievable objective names the action informatively', () => {
    const r = deriveAndExpose(makeSnapshot({
      dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 1, totalCount: 5, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 1, sessionTotal: 5, facts: {}, pendingCode: 'DNT_AGE' },
    }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Achievable now via: write_dnt_answer')
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
  it('briefing renders the pending DNT question code whenever a session is active — including DISCOVERY (pre-application)', () => {
    // The DISCOVERY-opened DNT flow (no application yet) is engine-legal; the
    // code must reach the prompt every turn or the model reconstructs it from
    // semantics (2026-07-06 debug report: DNT_INTEREST_INSURANCE_EDUCATION).
    const r = deriveAndExpose(makeSnapshot({ application: null, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 1, totalCount: 10, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 1, sessionTotal: 10, facts: {}, pendingCode: 'DNT_MARKETING_CONSENT' } }))
    expect(r.state.phase).toBe('DISCOVERY')
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('DNT current question code: DNT_MARKETING_CONSENT')
    expect(text).toContain('EXACT')
    // Correction guidance: without it the model writes correction requests
    // into the pinned CURRENT code (2026-07-06 change-answer sim).
    expect(text.toLowerCase()).toContain('already-answered')
  })
  it('briefing renders the pending DNT question code during APPLICATION/DNT too', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: null, level: null, addon: null, answeredCount: 0, requiredCount: 6, missingCodes: ['Q1'], frozen: false }, dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 2, totalCount: 5, sessionActive: true, latest: null, activeSessionId: 's1', sessionType: 'NEW', sessionAnswered: 2, sessionTotal: 5, facts: {}, pendingCode: 'DNT_INCOME_SOURCE' } }))
    expect(formatDerivedBriefing(r.state, r.actions)).toContain('DNT current question code: DNT_INCOME_SOURCE')
  })
  it('briefing omits the code line when no DNT session is active', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(formatDerivedBriefing(r.state, r.actions)).not.toContain('DNT current question code')
  })
  it('briefing announces a pending customer confirmation and countermands re-calling the tool (P0-5, 2026-07-06 sign_dnt loop)', () => {
    const r = deriveAndExpose(makeSnapshot({ pendingConfirmationTools: ['sign_dnt'] }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('AWAITING CUSTOMER CONFIRMATION: sign_dnt')
    expect(text).toContain('do NOT call sign_dnt again')
  })
  it('briefing omits the confirmation line when nothing is pending', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(formatDerivedBriefing(r.state, r.actions)).not.toContain('AWAITING CUSTOMER CONFIRMATION')
  })
  // T8 (design 2026-07-15 §3.2/§4): the briefing surfaces the ledgered intent —
  // same-session fresh = never re-ask readiness; cross-session or stale =
  // renew WITH CONTEXT via the data-grounded script.
  it('same-session active intent renders the do-not-re-ask directive with the config summary and the next action', () => {
    const daysAgo2 = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const r = deriveAndExpose(makeSnapshot({ intent: { goal: 'purchase', productCode: 'protect', config: { tier: 'standard', level: 'level_1', addon: true }, capturedAt: daysAgo2, sameSession: true, status: 'active' } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain(`Active intent: purchase protect (standard/level_1 + addon) — captured ${daysAgo2.slice(0, 10)}`)
    expect(text).toContain('The customer has already committed; do NOT re-ask')
    expect(text).toContain('Next: ')
  })
  it('cross-session active intent renders the renewal script anchored in recorded data (daysAgo + Continuăm?)', () => {
    const capturedAt = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const r = deriveAndExpose(makeSnapshot({ intent: { goal: 'quote', productCode: 'protect', config: { tier: 'standard' }, capturedAt, sameSession: false, status: 'active' } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).not.toContain('do NOT re-ask')
    expect(text).toContain('Acum 3 zile te interesa protect (standard)')
    expect(text).toContain('Continuăm?')
    // default snapshot: the discovery goal is achievable now → nothing missing
    expect(text).toContain('totul este pregătit')
    expect(text).toContain('renounce')
  })
  it('a same-session intent older than 7 days is stale — renewal script, not the do-not-re-ask line', () => {
    const capturedAt = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const r = deriveAndExpose(makeSnapshot({ intent: { goal: 'purchase', productCode: 'protect', config: null, capturedAt, sameSession: true, status: 'active' } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).not.toContain('do NOT re-ask')
    expect(text).toContain('Acum 10 zile te interesa protect')
    expect(text).toContain('Continuăm?')
  })
  it('the renewal script names the current missing preconditions when the goal is blocked', () => {
    const capturedAt = new Date(Date.now() - 9 * 86_400_000).toISOString()
    const r = deriveAndExpose(makeSnapshot({
      application: { id: 'a', status: 'OPEN', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: true },
      dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
      consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 500, validUntil: '2027-01-01T00:00:00.000Z', expired: false },
      intent: { goal: 'purchase', productCode: 'protect', config: null, capturedAt, sameSession: false, status: 'active' },
    }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('accept_quote (requires_identity)')
    expect(text).not.toContain('totul este pregătit')
  })
  it('no intent → no Active intent line', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(formatDerivedBriefing(r.state, r.actions)).not.toContain('Active intent')
  })
  it('renders blocked actions with machine reason codes so the agent can explain a block', () => {
    const r = deriveAndExpose(makeSnapshot({ application: { id: 'a', status: 'OPEN', tier: 't', level: 'l', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false }, dnt: { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} } }))
    const text = formatDerivedBriefing(r.state, r.actions)
    expect(text).toContain('Blocked actions:')
    expect(text).toContain('generate_quote (requires_consent')
    expect(text).toContain('NEVER work around a blocked action')
  })
})
