import { it, expect } from 'vitest'
import { deriveIdentityTier, evaluateIdentityRequirement, IDENTITY_REQUIREMENTS } from '@/lib/engines/identity-rules'

const contact = (over: Partial<Record<string, { value: string; provenance: 'declared' | 'verified' | 'conflict' }>> = {}) => ({
  fields: {
    email: { value: 'a@b.ro', provenance: 'declared' as const },
    phone: { value: '0712345678', provenance: 'declared' as const },
    ...over,
  },
  verifiedChannels: [] as ('email' | 'sms')[],
})

// T28 (P5.1): the pre-acceptance tiers are CONTACT tiers — email+phone
// declared → declared; + a consumed challenge → verified_channel. Name, CNP
// and DOB no longer gate tiers: the CNP arrives document-grade via ID
// extraction (T27), so requiring it here would wall the funnel behind data
// nobody is allowed to ask by mouth anymore.
it('tier is derived, never stored: anonymous → declared (email+phone) → verified_channel (+ consumed challenge)', () => {
  expect(deriveIdentityTier({ fields: {}, verifiedChannels: [] })).toBe('anonymous')
  expect(deriveIdentityTier(contact())).toBe('declared')
  expect(deriveIdentityTier({ ...contact(), verifiedChannels: ['email'] })).toBe('verified_channel')
})

it('email alone (no phone) stays anonymous; a conflicted contact field blocks the tier', () => {
  expect(deriveIdentityTier({ fields: { email: { value: 'a@b.ro', provenance: 'declared' } }, verifiedChannels: [] })).toBe('anonymous')
  expect(deriveIdentityTier(contact({ email: { value: 'a@b.ro', provenance: 'conflict' } }))).toBe('anonymous')
})

it('T28: name/CNP/DOB are NOT tier inputs — verified_channel is reachable without any of them', () => {
  expect(deriveIdentityTier({ ...contact(), verifiedChannels: ['email'] })).toBe('verified_channel')
  // an invalid CNP on file no longer drags the tier down (document review owns CNP quality)
  expect(deriveIdentityTier({ ...contact({ cnp: { value: '1980418089862', provenance: 'declared' } }), verifiedChannels: ['email'] })).toBe('verified_channel')
})

it('#1 rows: generate_quote needs declared cnp-or-dob-or-declaredAge; accept_quote needs verified_channel; ensure_payment_session adds product docs (D3.3)', () => {
  // no hard identity gate pre-needs-analysis (#1)
  expect(IDENTITY_REQUIREMENTS.set_application).toEqual({ minTier: 'anonymous' })
  const anon = { fields: {}, verifiedChannels: [] as ('email' | 'sms')[] }
  expect(evaluateIdentityRequirement('generate_quote', anon, [])).toEqual({ ok: false, needs: ['declared:cnp_or_dateOfBirth_or_declaredAge'] })
  expect(evaluateIdentityRequirement('generate_quote', { fields: { dateOfBirth: { value: '1998-04-18', provenance: 'declared' } }, verifiedChannels: [] }, [])).toEqual({ ok: true })
  // T28: the declared age ALONE unlocks quoting — "câți ani ai?" is the whole ask
  expect(evaluateIdentityRequirement('generate_quote', { fields: { declaredAge: { value: '35', provenance: 'declared' } }, verifiedChannels: [] }, [])).toEqual({ ok: true })
  expect(evaluateIdentityRequirement('accept_quote', contact(), [])).toEqual({ ok: false, needs: ['verified_channel'] })
  expect(evaluateIdentityRequirement('ensure_payment_session', { ...contact(), verifiedChannels: ['email'] }, ['id_card'])).toEqual({ ok: false, needs: ['document:id_card'] })
  // erratum 1: validated docs satisfy the product-document requirement
  expect(evaluateIdentityRequirement('ensure_payment_session', { ...contact(), verifiedChannels: ['email'] }, ['id_card'], ['id_card'])).toEqual({ ok: true })
})
