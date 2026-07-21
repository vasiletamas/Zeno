import { it, expect, beforeEach } from 'vitest'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { collectCustomerField } from '@/lib/tools/handlers/data-handlers'
import { getCustomerProfile } from '@/lib/tools/handlers/profile-handlers'
import { getProfile, setVerifiedField } from '@/lib/customer/profile-service'
import { getToolDefinition } from '@/lib/tools/registry'
import { prisma } from '@/lib/db'

beforeEach(async () => { await resetDb() })
// actor 'gui': this suite pins provenance routing, not the P0-1 grounding guard
const ctx = (id: string) => ({ customerId: id, conversationId: 'conv-x', language: 'ro' as const, db: prisma, actor: 'gui' })
it('collect_customer_field writes through the service with declared provenance', async () => {
  const c = await createCustomer({}, { channelProven: false })
  const r = await collectCustomerField({ field: 'email', value: 'ana@example.ro' }, ctx(c.id) as never)
  expect(r.success).toBe(true)
  expect((await getProfile(c.id)).fields.email).toMatchObject({ provenance: 'declared' })
})
it('collect_customer_field surfaces field_verified_immutable instead of overwriting', async () => {
  const c = await createCustomer({}, { channelProven: false })
  await setVerifiedField(c.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  const r = await collectCustomerField({ field: 'name', value: 'Alt Nume' }, ctx(c.id) as never)
  expect(r.success).toBe(false)
  expect(r.error).toContain('field_verified_immutable')
})
it('get_customer_profile exposes provenance; update_customer_profile is retired', async () => {
  const c = await createCustomer({}, { channelProven: false })
  await collectCustomerField({ field: 'email', value: 'a@b.ro' }, ctx(c.id) as never)
  const p = await getCustomerProfile({}, ctx(c.id) as never)
  expect((p.data as { profile: { fields: Record<string, { provenance: string }> } }).profile.fields.email.provenance).toBe('declared')
  expect(getToolDefinition('update_customer_profile')).toBeUndefined()
})
