import { it, expect } from 'vitest'
import { isDntValidFor, decideSessionType, computeCoverage, dntExposure, DNT_RENEWAL_WINDOW_DAYS } from '@/lib/engines/dnt-rules'
const now = new Date('2026-06-12')
const dnt = (over: Partial<{ validUntil: Date; productTypesCovered: 'LIFE'[]; status: string }> = {}) => ({ status: 'ACTIVE', signedAt: new Date('2026-01-01'), validUntil: new Date('2027-01-01'), productTypesCovered: ['LIFE' as const], ...over })

it('validity fails closed on coverage and expiry (T3.D3)', () => {
  expect(isDntValidFor(dnt(), 'LIFE', now)).toBe(true)
  expect(isDntValidFor(dnt({ validUntil: new Date('2026-06-01') }), 'LIFE', now)).toBe(false)
  expect(isDntValidFor(dnt({ productTypesCovered: [] }), 'LIFE', now)).toBe(false)
  expect(isDntValidFor(dnt({ status: 'WITHDRAWN' }), 'LIFE', now)).toBe(false)
  expect(isDntValidFor(null, 'LIFE', now)).toBe(false)
})

it('engine decides session type: no prior → NEW; any prior (incl. expired/expiring) → UPDATE (#7)', () => {
  expect(decideSessionType(null, now)).toBe('NEW')
  expect(decideSessionType(dnt({ validUntil: new Date('2026-05-01') }), now)).toBe('UPDATE')
  expect(decideSessionType(dnt({ validUntil: new Date(now.getTime() + (DNT_RENEWAL_WINDOW_DAYS - 1) * 86400e3) }), now)).toBe('UPDATE')
})

it('coverage is computed from what the session analyzed', () => { expect(computeCoverage('LIFE')).toEqual(['LIFE']) })

it('#12 exposure: renewal needs NO application; write needs active session + pending question; sign needs finished', () => {
  const base = { productTypeInFocus: 'LIFE' as const, latestDnt: dnt({ validUntil: new Date('2026-06-20') }), activeSession: null, sessionHasPendingQuestion: false, sessionFinished: false, openApplicationProductType: null, now }
  expect(dntExposure(base).available).toContain('open_dnt_session') // expiring within window, no application
  const inSession = { ...base, activeSession: { id: 's1' }, sessionHasPendingQuestion: true }
  expect(dntExposure(inSession).available).toEqual(expect.arrayContaining(['write_dnt_answer', 'get_dnt_next_question']))
  expect(dntExposure(inSession).blocked.find(b => b.action === 'open_dnt_session')).toMatchObject({ reason: 'dnt_session_already_active', params: { activeSessionId: 's1' } })
  expect(dntExposure({ ...base, activeSession: { id: 's1' }, sessionFinished: true }).available).toContain('sign_dnt')
})
