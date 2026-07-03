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

it('the re-grant floor survives withdrawal: DNT commits + escalate stay available', () => {
  const snap = makeSnapshot({
    consents: deriveConsents([{ kind: 'gdpr_processing', action: 'withdrawn', createdAt: new Date('2026-02-01') }]),
    dnt: { signed: false, valid: false, validUntil: null, coversProductTypes: [], answeredCount: 0, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
  })
  const { actions } = deriveAndExpose(snap)
  expect(actions.available).toContain('open_dnt_session')
  expect(actions.available).toContain('escalate_to_human')
  expect(actions.available).not.toContain('set_candidate_product')
  expect(actions.blocked.find(b => b.action === 'set_candidate_product')?.reason).toBe('gdpr_processing_withdrawn')
})

it('a fresh customer (no consent events) is never halted', () => {
  const { actions } = deriveAndExpose(makeSnapshot({ consents: deriveConsents([]) }))
  expect(actions.available).toContain('set_candidate_product')
  expect(actions.blocked.some(b => b.reason === 'gdpr_processing_withdrawn')).toBe(false)
})
