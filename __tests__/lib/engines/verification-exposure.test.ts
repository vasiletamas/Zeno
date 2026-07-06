import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { formatDerivedBriefing } from '@/lib/chat/phase-sections-map'
import type { DomainSnapshot } from '@/lib/engines/domain-types'
import { makeSnapshot } from './snapshot-fixtures'

// Task 1.1 (D5): the verification endgame is first-class engine state. The
// recorded conversation (cmr9a5zxx004whk0elbifvvvm) died here: quote ISSUED,
// challenge pending, and nextBestAction still said "call set_candidate_product"
// — the model re-sent the code (invalidating the live one) instead of calling
// the exposed confirm_channel_verification.

const issuedQuote = { id: 'q1', status: 'ISSUED', premiumAnnual: 190, validUntil: '2099-01-01T00:00:00.000Z', expired: false }
const withPending = (attemptsRemaining?: number): DomainSnapshot['identity'] => ({
  tier: 'declared',
  fields: { email: { provenance: 'declared' }, name: { provenance: 'declared' } },
  verifiedChannels: [],
  pendingChallenge: { channel: 'email', target: 'maria@example.ro', ...(attemptsRemaining !== undefined ? { attemptsRemaining } : {}) },
})

const deriveWithFixture = (over: Partial<DomainSnapshot>) => deriveAndExpose(makeSnapshot(over)).state
const exposeWithFixture = (over: Partial<DomainSnapshot>) => deriveAndExpose(makeSnapshot(over)).actions

describe('verification endgame exposure (Task 1.1, D5)', () => {
  it('pending challenge → nextBestAction is confirm_channel_verification', () => {
    const state = deriveWithFixture({ quote: issuedQuote, identity: withPending() })
    expect(state.nextBestAction).toBe('call confirm_channel_verification')
  })

  it('never set_candidate_product while a quote is ISSUED and a challenge is pending', () => {
    const state = deriveWithFixture({ quote: issuedQuote, identity: withPending() })
    expect(state.nextBestAction).not.toContain('set_candidate_product')
  })

  it('start_channel_verification blocked while challenge pending (no resend flag)', () => {
    const exposure = exposeWithFixture({ identity: withPending() })
    expect(exposure.available).not.toContain('start_channel_verification')
    expect(exposure.blocked).toContainEqual(expect.objectContaining({ action: 'start_channel_verification', reason: 'verification_already_pending' }))
  })

  it('no pending challenge → start_channel_verification stays available', () => {
    const exposure = exposeWithFixture({})
    expect(exposure.available).toContain('start_channel_verification')
  })
})

describe('verification briefing (Task 1.1, D5)', () => {
  it('renders the awaiting-code instruction with the masked target', () => {
    const r = deriveAndExpose(makeSnapshot({ quote: issuedQuote, identity: withPending() }))
    const briefing = formatDerivedBriefing(r.state, r.actions)
    expect(briefing).toContain('m***@example.ro')
    expect(briefing).toContain('confirm_channel_verification')
    expect(briefing).toMatch(/do not (re-?send|call start_channel_verification)/i)
  })

  it('surfaces attempts remaining after a wrong code', () => {
    const r = deriveAndExpose(makeSnapshot({ quote: issuedQuote, identity: withPending(3) }))
    const briefing = formatDerivedBriefing(r.state, r.actions)
    expect(briefing).toContain('3 attempts remaining')
  })

  // The re-ask lapse (2026-07-06 battery): the model occasionally re-asked a
  // KYC field it had already collected. The briefing must SHOW what is on
  // file, not just what is missing.
  it('lists the identity fields already on file with a do-not-re-ask instruction', () => {
    const identity = {
      tier: 'declared' as const,
      fields: { name: { provenance: 'declared' as const }, email: { provenance: 'verified' as const } },
      verifiedChannels: ['email'] as ('email' | 'sms')[], pendingChallenge: null,
    }
    const r = deriveAndExpose(makeSnapshot({ identity }))
    const briefing = formatDerivedBriefing(r.state, r.actions)
    expect(briefing).toMatch(/Identity on file: name, email/i)
    expect(briefing).toMatch(/do NOT ask.*again|never re-ask/i)
  })

  it('no identity-on-file line when nothing is declared', () => {
    const r = deriveAndExpose(makeSnapshot())
    expect(formatDerivedBriefing(r.state, r.actions)).not.toMatch(/Identity on file/i)
  })
})
