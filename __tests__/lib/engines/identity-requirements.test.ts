import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-requirements'
import { makeSnapshot } from './snapshot-fixtures'

describe('identity-requirements mechanism (contradiction #1)', () => {
  it('the B3.2 rows are landed — one row per ratified commit gate', () => {
    expect(Object.keys(IDENTITY_REQUIREMENTS).sort()).toEqual(
      ['accept_quote', 'generate_quote', 'initiate_payment', 'sign_dnt', 'start_application'],
    )
  })
  it('checkIdentityRequirement reports the missing needs payload', () => {
    const r = checkIdentityRequirement(
      { accept_quote: { minTier: 'verified_channel', anyDeclaredOf: ['cnp'] } },
      'accept_quote',
      { tier: 'declared', fields: {}, verifiedChannels: [] },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.needs).toEqual(['verified_channel', 'declared:cnp'])
  })
  it('product-document requirements resolve against validated documents', () => {
    const row = { initiate_payment: { minTier: 'anonymous' as const, productDocuments: true } }
    const identity = { tier: 'declared' as const, fields: {}, verifiedChannels: [] as ('email' | 'sms')[] }
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
