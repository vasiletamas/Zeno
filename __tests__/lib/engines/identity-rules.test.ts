import { it, expect } from 'vitest'
import { deriveIdentityTier, evaluateIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-rules'

const f = (over: Partial<Record<string, { value: string; provenance: 'declared' | 'verified' | 'conflict' }>> = {}) => ({
  fields: {
    name: { value: 'Ana Pop', provenance: 'declared' as const },
    cnp: { value: '1980418089861', provenance: 'declared' as const },
    dateOfBirth: { value: '1998-04-18', provenance: 'declared' as const },
    email: { value: 'a@b.ro', provenance: 'declared' as const },
    phone: { value: '0712345678', provenance: 'declared' as const },
    ...over,
  },
  verifiedChannels: [] as ('email' | 'sms')[],
})

it('tier is derived, never stored: anonymous → declared → verified_channel', () => {
  expect(deriveIdentityTier({ fields: {}, verifiedChannels: [] })).toBe('anonymous')
  expect(deriveIdentityTier(f())).toBe('declared')
  expect(deriveIdentityTier({ ...f(), verifiedChannels: ['email'] })).toBe('verified_channel')
})

it('invalid CNP checksum blocks the declared tier', () => {
  expect(deriveIdentityTier(f({ cnp: { value: '1980418089862', provenance: 'declared' } }))).toBe('anonymous')
})

it('#1 rows: generate_quote needs declared cnp-or-dob; accept_quote needs verified_channel; ensure_payment_session adds product docs (D3.3)', () => {
  // no hard identity gate pre-needs-analysis (#1)
  expect(IDENTITY_REQUIREMENTS.set_application).toEqual({ minTier: 'anonymous' })
  const anon = { fields: {}, verifiedChannels: [] as ('email' | 'sms')[] }
  expect(evaluateIdentityRequirement('generate_quote', anon, [])).toEqual({ ok: false, needs: ['declared:cnp_or_dateOfBirth'] })
  expect(evaluateIdentityRequirement('generate_quote', { fields: { dateOfBirth: { value: '1998-04-18', provenance: 'declared' } }, verifiedChannels: [] }, [])).toEqual({ ok: true })
  expect(evaluateIdentityRequirement('accept_quote', f(), [])).toEqual({ ok: false, needs: ['verified_channel'] })
  expect(evaluateIdentityRequirement('ensure_payment_session', { ...f(), verifiedChannels: ['email'] }, ['id_card'])).toEqual({ ok: false, needs: ['document:id_card'] })
  // erratum 1: validated docs satisfy the product-document requirement
  expect(evaluateIdentityRequirement('ensure_payment_session', { ...f(), verifiedChannels: ['email'] }, ['id_card'], ['id_card'])).toEqual({ ok: true })
})
