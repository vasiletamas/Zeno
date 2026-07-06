import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-requirements'
import { listCommitTools } from '@/lib/tools/registry'
import { makeSnapshot } from './snapshot-fixtures'

describe('identity-requirements mechanism (contradiction #1)', () => {
  it('the B3.2 + E3 rows are landed — one row per ratified commit gate', () => {
    expect(Object.keys(IDENTITY_REQUIREMENTS).sort()).toEqual(
      ['accept_quote', 'ensure_payment_session', 'generate_quote', 'request_data_export', 'request_erasure', 'set_application', 'sign_dnt'],
    )
  })
  it('pins the ratified rows (ADD-1, erratum-4a encoding)', () => {
    expect(IDENTITY_REQUIREMENTS.generate_quote).toEqual({ minTier: 'anonymous', anyDeclaredOf: ['cnp', 'dateOfBirth'] })
    expect(IDENTITY_REQUIREMENTS.accept_quote).toEqual({ minTier: 'verified_channel' })
    // D3.3: the document requirement rides ensure_payment_session
    expect(IDENTITY_REQUIREMENTS.ensure_payment_session).toEqual({ minTier: 'verified_channel', productDocuments: true })
    // E3 (M3): export demands a proven channel; erasure stays open to an
    // anonymous chat user (erratum 6 ruling — the right cannot hide behind
    // the identity data it erases)
    expect(IDENTITY_REQUIREMENTS.request_data_export).toEqual({ minTier: 'verified_channel' })
    expect(IDENTITY_REQUIREMENTS.request_erasure).toEqual({ minTier: 'anonymous' })
  })
  it('every key is a registered commit tool (ADD-1)', () => {
    const commits = new Set(listCommitTools())
    for (const k of Object.keys(IDENTITY_REQUIREMENTS)) expect(commits.has(k), k).toBe(true)
  })
  it('checkIdentityRequirement reports the missing needs payload', () => {
    const allDeclared = Object.fromEntries(['name', 'cnp', 'dateOfBirth', 'email', 'phone'].map((f) => [f, { provenance: 'declared' as const }]))
    const r = checkIdentityRequirement(
      { accept_quote: { minTier: 'verified_channel' } },
      'accept_quote',
      { tier: 'declared', fields: allDeclared, verifiedChannels: [], pendingChallenge: null },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.needs).toEqual(['verified_channel'])
  })
  // The recorded conversation's endgame killer (D5): the customer verified
  // the email, but dateOfBirth+phone were never collected — the needs still
  // said 'verified_channel', so the agent looped on re-verifying and
  // hallucinated what was missing. The needs must name the ACTUAL gaps.
  it('names the missing KYC fields when the channel is already verified (never a tier word the agent already satisfied)', () => {
    const r = checkIdentityRequirement(
      IDENTITY_REQUIREMENTS,
      'accept_quote',
      {
        tier: 'anonymous',
        fields: { name: { provenance: 'declared' }, cnp: { provenance: 'declared' }, email: { provenance: 'verified' } },
        verifiedChannels: ['email'],
        pendingChallenge: null,
      },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.needs).toEqual(['declared:dateOfBirth', 'declared:phone'])
      expect(r.needs).not.toContain('verified_channel')
    }
  })
  it('asks for BOTH the fields and the channel when neither is satisfied', () => {
    const r = checkIdentityRequirement(
      IDENTITY_REQUIREMENTS,
      'accept_quote',
      { tier: 'anonymous', fields: { name: { provenance: 'declared' } }, verifiedChannels: [], pendingChallenge: null },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.needs).toEqual(['declared:cnp', 'declared:dateOfBirth', 'declared:email', 'declared:phone', 'verified_channel'])
  })
  it('falls back to valid:cnp when fields+channel are complete but the tier still refuses (checksum/DOB mismatch)', () => {
    const allDeclared = Object.fromEntries(['name', 'cnp', 'dateOfBirth', 'email', 'phone'].map((f) => [f, { provenance: 'declared' as const }]))
    const r = checkIdentityRequirement(
      IDENTITY_REQUIREMENTS,
      'accept_quote',
      { tier: 'anonymous', fields: allDeclared, verifiedChannels: ['email'], pendingChallenge: null },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.needs).toEqual(['valid:cnp'])
  })
  it('product-document requirements resolve against validated documents', () => {
    const row = { initiate_payment: { minTier: 'anonymous' as const, productDocuments: true } }
    const identity = { tier: 'declared' as const, fields: {}, verifiedChannels: [] as ('email' | 'sms')[], pendingChallenge: null }
    const missing = checkIdentityRequirement(row, 'initiate_payment', identity, ['id_card'], [])
    expect(missing).toEqual({ ok: false, needs: ['document:id_card'] })
    expect(checkIdentityRequirement(row, 'initiate_payment', identity, ['id_card'], ['id_card'])).toEqual({ ok: true })
  })
  it('an unmet requirement turns an otherwise-exposed action into blocked requires_identity with needs', () => {
    const s = makeSnapshot() // set_candidate_product is normally always exposed
    const r = deriveAndExpose(s, { identityRequirements: { set_candidate_product: { minTier: 'declared' } } })
    expect(r.actions.available).not.toContain('set_candidate_product')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'set_candidate_product', reason: 'requires_identity', params: { needs: ['declared'] } }))
  })
})
