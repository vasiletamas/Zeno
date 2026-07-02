import { describe, it, expect } from 'vitest'
import { deriveAndExpose, ACTION_RULES, engineVersion } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

const validDnt = { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0 }
const doneApp = { id: 'app-1', status: 'COMPLETED' as const, tier: 'standard', level: 'l1', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [] }

describe('deriveAndExpose — exposure over the FULL snapshot (contradiction #12)', () => {
  it('escalate_to_human is ALWAYS available (exposure floor)', () => {
    expect(deriveAndExpose(makeSnapshot()).actions.available).toContain('escalate_to_human')
  })
  it('DISCOVERY: funnel commits are not available; accept_quote is blocked with no_issued_quote only when an application exists', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(r.actions.available).not.toContain('accept_quote')
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.available).toContain('list_products')
  })
  it('generate_quote blocked with requires_consent when questionnaire complete but GDPR missing', () => {
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt }))
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'requires_consent' }))
  })
  it('generate_quote available in APPLICATION/QUOTE_GENERATION with consent and declared cnp-or-dob (#1 row, B3.2)', () => {
    const identity = { tier: 'anonymous' as const, fields: { dateOfBirth: { provenance: 'declared' as const } }, verifiedChannels: [] as ('email' | 'sms')[], pendingChallenge: null }
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, identity, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true } }))
    expect(r.actions.available).toContain('generate_quote')
  })
  it('generate_quote blocked requires_identity with declared:cnp_or_dateOfBirth when neither is declared (#1 row, B3.2)', () => {
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true } }))
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'requires_identity', params: { needs: ['declared:cnp_or_dateOfBirth'] } }))
  })
  it('sign_dnt blocked with dnt_session_incomplete while the ACTIVE session has pending questions (B2)', () => {
    const s = makeSnapshot({ application: { ...doneApp, status: 'OPEN', missingCodes: ['Q1'] }, dnt: { ...validDnt, signed: false, valid: false, latest: null, activeSessionId: 'sess-1', sessionType: 'NEW', sessionAnswered: 2, sessionTotal: 10 } })
    const r = deriveAndExpose(s)
    expect(r.actions.available).not.toContain('sign_dnt')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'sign_dnt', reason: 'dnt_session_incomplete' }))
    // finished session flips it to available
    const done = deriveAndExpose(makeSnapshot({ dnt: { ...validDnt, signed: false, valid: false, latest: null, activeSessionId: 'sess-1', sessionType: 'NEW', sessionAnswered: 10, sessionTotal: 10 } }))
    expect(done.actions.available).toContain('sign_dnt')
  })
  it('a circuit-open tool moves to blocked temporarily_unavailable (M10)', () => {
    const r = deriveAndExpose(makeSnapshot({ circuit: { openTools: ['list_products'] } }))
    expect(r.actions.available).not.toContain('list_products')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'list_products', reason: 'temporarily_unavailable' }))
  })
  it('INVARIANT: nextBestAction only names an available action', () => {
    for (const s of [makeSnapshot(), makeSnapshot({ application: doneApp, dnt: validDnt, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true } })]) {
      const r = deriveAndExpose(s)
      const m = r.state.nextBestAction.match(/call ([a-z_]+)/)
      if (m) expect(r.actions.available).toContain(m[1])
    }
  })
  it('every rule action is unique and kind-tagged', () => {
    const names = ACTION_RULES.map((r) => r.action)
    expect(new Set(names).size).toBe(names.length)
    for (const r of ACTION_RULES) expect(['read', 'commit']).toContain(r.kind)
  })
  it('exports an engineVersion stamp for legality-snapshot replay (T14.D2)', () => {
    expect(typeof engineVersion).toBe('string')
    expect(engineVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('catalog discovery works from a completely empty snapshot (heir of discovery-empty-catalog)', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(r.actions.available).toContain('list_products')
    expect(r.actions.available).toContain('get_product_info')
    expect(r.actions.available).toContain('escalate_to_human')
  })
})
