import { it, expect, beforeEach } from 'vitest'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { setDeclaredField } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetFunnelTables() })

const ctx = (id: string) => ({ customerId: id, conversationId: 'c', language: 'ro' as const }) as never

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
