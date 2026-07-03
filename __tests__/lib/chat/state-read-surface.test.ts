import { describe, it, expect } from 'vitest'
import { getToolDefinition } from '@/lib/tools/registry'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { formatDerivedBriefing } from '@/lib/chat/phase-sections-map'
import { makeSnapshot } from '../engines/snapshot-fixtures'

describe('T13.D8 hybrid state surface', () => {
  it('get_application_status is retired', () => {
    expect(getToolDefinition('get_application_status')).toBeUndefined()
  })
  it('get_current_state survives as the single detail read', () => {
    expect(getToolDefinition('get_current_state')).toBeDefined()
  })
  it('flagsForReview surfaces alert-worthy facts (expiring DNT, conflict fields) in DerivedStateV3', () => {
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days out
    const r = deriveAndExpose(makeSnapshot({
      dnt: { signed: true, valid: true, validUntil: soon, coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} },
      identity: { tier: 'declared', fields: { email: { provenance: 'conflict' } }, verifiedChannels: [], pendingChallenge: null },
    }))
    expect(r.state.flagsForReview).toContain('dnt_expiring')
    expect(r.state.flagsForReview).toContain('identity_conflict:email')
  })
  it('flagsForReview is empty on a calm snapshot and rendered in the injected summary only when present', () => {
    const calm = deriveAndExpose(makeSnapshot())
    expect(calm.state.flagsForReview).toEqual([])
    expect(formatDerivedBriefing(calm.state, calm.actions)).not.toContain('Flags for review')
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
    const flagged = deriveAndExpose(makeSnapshot({ dnt: { signed: true, valid: true, validUntil: soon, coversProductTypes: ['LIFE'], answeredCount: 5, totalCount: 5, sessionActive: false, latest: null, activeSessionId: null, sessionType: null, sessionAnswered: 0, sessionTotal: 0, facts: {} } }))
    expect(formatDerivedBriefing(flagged.state, flagged.actions)).toContain('Flags for review: dnt_expiring')
  })
})
