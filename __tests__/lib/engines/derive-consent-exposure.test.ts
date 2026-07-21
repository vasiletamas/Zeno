import { it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { deriveConsents } from '@/lib/customer/consent'
import { makeSnapshot } from './snapshot-fixtures'

// T12.D3: pure, snapshot-literal. The withdrawn consents slice is derived
// through the same reducer the snapshot loader uses.
it('gdpr-withdrawn snapshot blocks writing commits with gdpr_processing_withdrawn', () => {
  const snap = makeSnapshot({
    consents: deriveConsents([
      { kind: 'gdpr_processing', action: 'granted', createdAt: new Date('2026-01-01') },
      { kind: 'gdpr_processing', action: 'withdrawn', createdAt: new Date('2026-02-01') },
    ]),
  })
  const { state, actions } = deriveAndExpose(snap)
  expect(state.consents.gdprProcessing).toBe(false)
  const blockedTools = actions.blocked.map(b => b.action)
  expect(actions.available.filter(a => blockedTools.includes(a))).toEqual([])
  expect(actions.blocked.some(b => b.reason === 'gdpr_processing_withdrawn')).toBe(true)
})

const WITHDRAWN_NO_DNT = {
  consents: deriveConsents([{ kind: 'gdpr_processing' as const, action: 'withdrawn' as const, createdAt: new Date('2026-02-01') }]),
  dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
}

it('the re-grant floor survives withdrawal for a PROVEN customer: DNT commits + escalate stay available', () => {
  // makeSnapshot defaults to a proven channel (see snapshot-fixtures.ts).
  const { actions } = deriveAndExpose(makeSnapshot(WITHDRAWN_NO_DNT))
  expect(actions.available).toContain('open_dnt_session')
  expect(actions.available).toContain('escalate_to_human')
  expect(actions.available).not.toContain('set_candidate_product')
  expect(actions.blocked.find(b => b.action === 'set_candidate_product')?.reason).toBe('gdpr_processing_withdrawn')
})

/**
 * RULING D2 (2026-07-21) — the identity gate OUTRANKS the consent re-grant
 * floor, and this test pins that as INTENDED, not as a regression.
 *
 * consent-rules.ts puts the DNT trio in HALT_EXEMPT specifically so a withdrawn
 * customer can re-grant ("otherwise sign_dnt is exempt but unreachable and
 * re-granting deadlocks"). The R2 identity rows now stand in front of that
 * escape hatch: consent is decided first (derive-and-expose.ts:431), identity
 * second (:438), so an exempt-but-unverified customer is still refused.
 *
 * Accepted trade-off with two known populations: customers who signed
 * anonymously before this change, and anyone whose contact fields were cleared
 * by request_erasure (deliberately anonymous-tier and HALT_EXEMPT). Both must
 * prove a channel before re-granting. `escalate_to_human` remains the way out —
 * asserted below so the deadlock is never total.
 */
it('D2: a withdrawn AND unverified customer cannot re-grant — identity outranks the floor', () => {
  const snap = makeSnapshot({
    ...WITHDRAWN_NO_DNT,
    identity: { tier: 'anonymous', fields: {}, verifiedChannels: [], pendingChallenge: null },
  })
  const { actions } = deriveAndExpose(snap)

  expect(actions.available).not.toContain('open_dnt_session')
  expect(actions.blocked).toContainEqual(
    expect.objectContaining({ action: 'open_dnt_session', reason: 'requires_identity', params: { needs: ['verified_channel'] } }),
  )
  // never a TOTAL deadlock: the human path is unconditional
  expect(actions.available).toContain('escalate_to_human')
})

it('a fresh customer (no consent events) is never halted', () => {
  const { actions } = deriveAndExpose(makeSnapshot({ consents: deriveConsents([]) }))
  expect(actions.available).toContain('set_candidate_product')
  expect(actions.blocked.some(b => b.reason === 'gdpr_processing_withdrawn')).toBe(false)
})
