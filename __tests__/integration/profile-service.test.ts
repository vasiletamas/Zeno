import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { setDeclaredField, setVerifiedField, getProfile, getAge } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetDb() })
it('declared write lands with provenance and maintains the Customer mirror columns', async () => {
  const c = await createCustomer()
  expect((await setDeclaredField(c.id, 'email', 'ana@example.ro', 'collect_customer_field')).outcome).toBe('applied')
  expect((await getProfile(c.id)).fields.email).toMatchObject({ value: 'ana@example.ro', provenance: 'declared' })
  expect((await prisma.customer.findUnique({ where: { id: c.id } }))?.email).toBe('ana@example.ro')
})
it('declared over differing verified → rejected(field_verified_immutable)', async () => {
  const c = await createCustomer()
  await setVerifiedField(c.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  expect(await setDeclaredField(c.id, 'name', 'Alt Nume', 'collect_customer_field')).toMatchObject({ outcome: 'rejected', reason: 'field_verified_immutable' })
})
it('age derives DOB → declaredAge, never stored', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'declaredAge', '41', 'chat')
  expect(await getAge(c.id)).toBe(41)
  await setDeclaredField(c.id, 'dateOfBirth', '1990-05-01', 'collect_customer_field')
  expect(await getAge(c.id)).toBeGreaterThanOrEqual(35)
  expect((await getProfile(c.id)).fields).not.toHaveProperty('age')
})
it('declaring an email already mirrored on another customer keeps the row, skips the mirror, flags mirrorConflict (B0 erratum 3)', async () => {
  await createCustomer({ email: 'ion@example.ro' })
  const anon = await createCustomer()
  const w = await setDeclaredField(anon.id, 'email', 'ion@example.ro', 'collect_customer_field')
  expect(w).toMatchObject({ outcome: 'applied', mirrorConflict: 'email_in_use' })
  expect((await getProfile(anon.id)).fields.email).toMatchObject({ value: 'ion@example.ro', provenance: 'declared' })
  expect((await prisma.customer.findUnique({ where: { id: anon.id } }))?.email).toBeNull()
})
it('cnp is stored encrypted and masked on read', async () => {
  const c = await createCustomer()
  await setDeclaredField(c.id, 'cnp', '1980418089861', 'collect_customer_field')
  const row = await prisma.customerProfileField.findUnique({ where: { customerId_field: { customerId: c.id, field: 'cnp' } } })
  expect(row!.value).not.toContain('1980418089861')
  expect((await getProfile(c.id)).fields.cnp!.value).toMatch(/^1980\*{6}861$/)
})
