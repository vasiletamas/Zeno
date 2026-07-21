import { describe, it, expect } from 'vitest'
import { deriveAndExpose, ACTION_RULES, engineVersion } from '@/lib/engines/derive-and-expose'
import { makeSnapshot } from './snapshot-fixtures'

const validDnt = { signed: true, valid: true, validUntil: '2027-01-01T00:00:00.000Z', coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} }
// B4: the app stays OPEN through quoting — COMPLETED is terminal (T5.D6)
const doneApp = { id: 'app-1', status: 'OPEN' as const, tier: 'standard', level: 'l1', addon: false, answeredCount: 6, requiredCount: 6, missingCodes: [], frozen: false }

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
  it('generate_quote blocked requires_identity with declared:cnp_or_dateOfBirth_or_declaredAge when none is declared (#1 row, B3.2 + T28)', () => {
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true } }))
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'requires_identity', params: { needs: ['declared:cnp_or_dateOfBirth_or_declaredAge'] } }))
  })
  it('T28: a declared AGE alone satisfies the generate_quote identity row', () => {
    const identity = { tier: 'anonymous' as const, fields: { declaredAge: { provenance: 'declared' as const } }, verifiedChannels: [] as ('email' | 'sms')[], pendingChallenge: null }
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, identity, consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true } }))
    expect(r.actions.available).toContain('generate_quote')
  })
  // 2026-07-06 battery wall: the customer verified the email yet accept_quote
  // still said needs ['verified_channel'] — the agent gave up on the close.
  // The blocked payload must name the PRECISE missing piece (here: phone).
  it('QUOTE: accept_quote blocked requires_identity names the actual missing KYC piece, never a bare tier word', () => {
    const identity = {
      tier: 'declared' as const,
      fields: {
        name: { provenance: 'declared' as const }, cnp: { provenance: 'declared' as const },
        dateOfBirth: { provenance: 'declared' as const }, email: { provenance: 'verified' as const },
      },
      verifiedChannels: ['email'] as ('email' | 'sms')[], pendingChallenge: null,
    }
    const r = deriveAndExpose(makeSnapshot({
      application: doneApp, dnt: validDnt, identity,
      consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
      quote: { id: 'q1', status: 'ISSUED', premiumAnnual: 190, validUntil: '2027-01-01T00:00:00.000Z', expired: false, disclosuresRequired: [] },
    }))
    expect(r.actions.available).not.toContain('accept_quote')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({
      action: 'accept_quote', reason: 'requires_identity', params: { needs: ['declared:phone'] },
    }))
  })
  it('sign_dnt blocked with dnt_session_incomplete while the ACTIVE session has pending questions (B2)', () => {
    const s = makeSnapshot({ application: { ...doneApp, status: 'OPEN', missingCodes: ['Q1'], frozen: false }, dnt: { ...validDnt, signed: false, valid: false, latest: null, activeSessionId: 'sess-1', sessionType: 'NEW', sessionAnswered: 2, sessionTotal: 10, facts: {} } })
    const r = deriveAndExpose(s)
    expect(r.actions.available).not.toContain('sign_dnt')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'sign_dnt', reason: 'dnt_session_incomplete' }))
    // finished session flips it to available
    const done = deriveAndExpose(makeSnapshot({ dnt: { ...validDnt, signed: false, valid: false, latest: null, activeSessionId: 'sess-1', sessionType: 'NEW', sessionAnswered: 10, sessionTotal: 10, facts: {} } }))
    expect(done.actions.available).toContain('sign_dnt')
  })
  // T6.D3 deviation (2026-07-06): batch medical-declaration signature
  const consented = { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true }
  const declaredId = { tier: 'anonymous' as const, fields: { dateOfBirth: { provenance: 'declared' as const } }, verifiedChannels: [] as ('email' | 'sms')[], pendingChallenge: null }
  it('sign_medical_declarations exposed when all sensitive answers are in and unsigned', () => {
    const app = { ...doneApp, medicalDeclarations: { requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: false } }
    const r = deriveAndExpose(makeSnapshot({ application: app, dnt: validDnt, identity: declaredId, consents: consented }))
    expect(r.actions.available).toContain('sign_medical_declarations')
  })
  it('generate_quote blocked medical_declarations_unsigned until the batch sign; signed unblocks it', () => {
    const unsigned = { ...doneApp, medicalDeclarations: { requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: false } }
    const r = deriveAndExpose(makeSnapshot({ application: unsigned, dnt: validDnt, identity: declaredId, consents: consented }))
    expect(r.actions.available).not.toContain('generate_quote')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'generate_quote', reason: 'medical_declarations_unsigned' }))
    const signed = { ...doneApp, medicalDeclarations: { requiredCodes: ['BD_CANCER_HISTORY'], answeredCodes: ['BD_CANCER_HISTORY'], signed: true } }
    const r2 = deriveAndExpose(makeSnapshot({ application: signed, dnt: validDnt, identity: declaredId, consents: consented }))
    expect(r2.actions.available).toContain('generate_quote')
    expect(r2.actions.available).not.toContain('sign_medical_declarations')
    expect(r2.actions.blocked).toContainEqual(expect.objectContaining({ action: 'sign_medical_declarations', reason: 'already_applied' }))
  })
  // T10: the batch write is exposed exactly when write_question_answer is
  // exposed AND every pending question is a BD_* code (the bd_medical group
  // closes the questionnaire, so all-missing-BD ⟺ the pending question is BD).
  it('write_medical_batch exposed exactly while every missing code is BD_* and the questionnaire is writable', () => {
    const bdPending = { ...doneApp, addon: true, answeredCount: 1, requiredCount: 7, missingCodes: ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT'] }
    const r = deriveAndExpose(makeSnapshot({ application: bdPending, dnt: validDnt, consents: consented }))
    expect(r.actions.available).toContain('write_medical_batch')
    expect(r.actions.available).toContain('write_question_answer') // typed fallback stays

    // a non-BD question still pending → the single-question flow, no batch
    const mixedPending = { ...bdPending, missingCodes: ['HEALTH_DECLARATION_CONFIRM', ...bdPending.missingCodes] }
    const r2 = deriveAndExpose(makeSnapshot({ application: mixedPending, dnt: validDnt, consents: consented }))
    expect(r2.actions.available).not.toContain('write_medical_batch')
    expect(r2.actions.blocked).not.toContainEqual(expect.objectContaining({ action: 'write_medical_batch' }))

    // questionnaire complete → gone
    const r3 = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, consents: consented }))
    expect(r3.actions.available).not.toContain('write_medical_batch')
  })
  it('write_medical_batch mirrors write_question_answer blocks: requires_consent pre-DNT, application_frozen post-quote', () => {
    const bdPending = { ...doneApp, addon: true, answeredCount: 1, requiredCount: 7, missingCodes: ['BD_CANCER_HISTORY'] }
    const noDnt = deriveAndExpose(makeSnapshot({ application: bdPending, consents: consented }))
    expect(noDnt.actions.available).not.toContain('write_medical_batch')
    expect(noDnt.actions.blocked).toContainEqual(expect.objectContaining({ action: 'write_medical_batch', reason: 'requires_consent' }))

    const frozen = deriveAndExpose(makeSnapshot({ application: { ...bdPending, frozen: true }, dnt: validDnt, consents: consented }))
    expect(frozen.actions.available).not.toContain('write_medical_batch')
    expect(frozen.actions.blocked).toContainEqual(expect.objectContaining({ action: 'write_medical_batch', reason: 'application_frozen' }))
  })
  it('no sensitive questions in the visible set: gate and tool both absent (legacy snapshots unchanged)', () => {
    const r = deriveAndExpose(makeSnapshot({ application: doneApp, dnt: validDnt, identity: declaredId, consents: consented }))
    expect(r.actions.available).toContain('generate_quote')
    expect(r.actions.available).not.toContain('sign_medical_declarations')
    expect(r.actions.blocked).not.toContainEqual(expect.objectContaining({ action: 'sign_medical_declarations' }))
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

  /**
   * Ruling R2 (spec 2026-07-21 §3.2): authentication at APPLICATION START.
   * The DNT and medical questionnaire hold the most sensitive data in the
   * product and were previously collected entirely unverified — the window in
   * which the session reauth gate cannot fire, because that gate needs an
   * account and the account is born at OTP confirmation.
   *
   * makeSnapshot() now defaults to a proven channel so unrelated suites stay
   * focused; THIS is the case that pins the blocked side, so that default can
   * never silently hide the gate.
   */
  it('R2: an unverified customer cannot reach ANY sensitive-collection commit', () => {
    const unverified = makeSnapshot({
      identity: { tier: 'anonymous', fields: {}, verifiedChannels: [], pendingChallenge: null },
      consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
      dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
    })
    const r = deriveAndExpose(unverified)

    expect(r.actions.available).not.toContain('open_dnt_session')
    expect(r.actions.blocked).toContainEqual(
      expect.objectContaining({ action: 'open_dnt_session', reason: 'requires_identity', params: { needs: ['verified_channel'] } }),
    )
  })

  it('R2: the SAME snapshot with a proven channel opens the DNT (AC-1 step 6)', () => {
    const base = {
      consents: { gdprProcessing: true, aiDisclosure: true, marketing: false, gdprWithdrawn: false, hasAnyEvents: true },
      dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
    }
    // email only, no phone — her TIER is still 'anonymous' (D1: that is the
    // deadlock the channelProven clause exists to avoid).
    const verified = makeSnapshot({
      ...base,
      identity: { tier: 'anonymous', fields: { email: { provenance: 'verified' } }, verifiedChannels: ['email'], pendingChallenge: null },
    })

    expect(deriveAndExpose(verified).actions.available).toContain('open_dnt_session')
  })

})
