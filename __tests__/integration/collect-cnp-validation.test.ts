import { it, expect, beforeEach } from 'vitest'
import { createCustomer, resetFunnelTables } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { getProfile, setDeclaredField } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetFunnelTables() })

// actor 'gui': these suites pin validation semantics, not the P0-1 grounding guard
const ctx = (id: string) => ({ customerId: id, conversationId: 'c', language: 'ro' as const, actor: 'gui' }) as never

it('rejects checksum-invalid CNP with a precise reason', async () => {
  const c = await createCustomer()
  const r = await collectCustomerField({ field: 'cnp', value: '1980418089862' }, ctx(c.id))
  expect(r.success).toBe(false)
  expect(r.error).toContain('cnp_checksum_invalid')
})

it('rejects CNP inconsistent with the declared DOB', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'dateOfBirth', '1990-01-01', 'collect_customer_field')
  const r = await collectCustomerField({ field: 'cnp', value: '1980418089861' }, ctx(c.id)) // encodes 1998-04-18
  expect(r.success).toBe(false)
  expect(r.error).toContain('cnp_dob_mismatch')
})

it('accepts a consistent CNP', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'dateOfBirth', '1998-04-18', 'collect_customer_field')
  expect((await collectCustomerField({ field: 'cnp', value: '1980418089861' }, ctx(c.id))).success).toBe(true)
})

// T28 (P5.1): the DNT no longer asks the CNP at all (data minimization —
// the CNP arrives document-grade via ID extraction). The write_dnt_answer
// CNP special-cases died with the question; collect_customer_field above
// remains the ONLY by-mouth CNP path (kept for volunteered values).

// T28: the quote rates on the declared AGE asked directly ("câți ani ai?") —
// collect_customer_field accepts field 'declaredAge' as an integer 18-120.
it('collect_customer_field accepts declaredAge (integer 18-120) and writes it to the profile store', async () => {
  const c = await createCustomer()
  const r = await collectCustomerField({ field: 'declaredAge', value: '35' }, ctx(c.id))
  expect(r.success).toBe(true)
  const profile = await getProfile(c.id)
  expect(profile.fields.declaredAge?.value).toBe('35')
})

it('collect_customer_field rejects a non-integer or out-of-range declaredAge', async () => {
  const c = await createCustomer()
  expect((await collectCustomerField({ field: 'declaredAge', value: 'treizeci' }, ctx(c.id))).success).toBe(false)
  expect((await collectCustomerField({ field: 'declaredAge', value: '17' }, ctx(c.id))).success).toBe(false)
  expect((await collectCustomerField({ field: 'declaredAge', value: '121' }, ctx(c.id))).success).toBe(false)
  expect((await collectCustomerField({ field: 'declaredAge', value: '35.5' }, ctx(c.id))).success).toBe(false)
})
