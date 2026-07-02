import { describe, it, expect } from 'vitest'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { checkIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-requirements'
import { makeSnapshot } from './snapshot-fixtures'

describe('identity-requirements mechanism (contradiction #1)', () => {
  it('the shipped table is empty — rows are Block B data', () => {
    expect(Object.keys(IDENTITY_REQUIREMENTS)).toEqual([])
  })
  it('checkIdentityRequirement reports the missing needs payload', () => {
    const r = checkIdentityRequirement({ accept_quote: { minTier: 'verified_channel', requiredFields: ['cnp'] } }, 'accept_quote', { tier: 'declared', fields: {} })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.needs).toEqual(['tier:verified_channel', 'declared:cnp'])
  })
  it('an unmet requirement turns an otherwise-exposed action into blocked requires_identity with needs', () => {
    const s = makeSnapshot() // set_candidate_product is normally always exposed
    const r = deriveAndExpose(s, { identityRequirements: { set_candidate_product: { minTier: 'declared', requiredFields: [] } } })
    expect(r.actions.available).not.toContain('set_candidate_product')
    expect(r.actions.blocked).toContainEqual(expect.objectContaining({ action: 'set_candidate_product', reason: 'requires_identity', params: { needs: ['tier:declared'] } }))
  })
})
