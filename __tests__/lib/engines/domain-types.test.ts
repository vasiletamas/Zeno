import { describe, it, expect } from 'vitest'
import { PHASES, APP_SUBPHASES, IDENTITY_TIERS, COMMIT_OUTCOMES, COMMIT_EFFECTS, REASON_CODES } from '@/lib/engines/domain-types'

describe('pinned vocabulary closure (taxonomy-closure seed)', () => {
  it('Phase is exactly the 5 pinned values in funnel order', () => {
    expect([...PHASES]).toEqual(['DISCOVERY', 'APPLICATION', 'QUOTE', 'PAYMENT', 'POLICY'])
  })
  it('AppSubphase is exactly the 3 pinned values', () => {
    expect([...APP_SUBPHASES]).toEqual(['DNT', 'QUESTIONNAIRE', 'QUOTE_GENERATION'])
  })
  it('CommitOutcome is exactly the 9 pinned values', () => {
    expect([...COMMIT_OUTCOMES]).toEqual(['applied', 'rejected', 'referred', 'pending', 'unavailable', 'requires_confirmation', 'requires_identity', 'requires_consent', 'requires_disclosures'])
  })
  it('CommitEffect is exactly the 7 pinned values', () => {
    expect([...COMMIT_EFFECTS]).toEqual(['advance_phase', 're_rating', 'cascade_invalidate', 'cascade_expand', 'questions_removed', 'eligibility_recheck', 'terminal'])
  })
  it('IdentityTier is exactly the 3 pinned values', () => {
    expect([...IDENTITY_TIERS]).toEqual(['anonymous', 'declared', 'verified_channel'])
  })
  it('every ReasonCode is stable snake_case (M6: engine never emits prose)', () => {
    for (const code of REASON_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length)
  })
})
