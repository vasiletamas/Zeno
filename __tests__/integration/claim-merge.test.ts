import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { claimAndMerge } from '@/lib/customer/claim-merge'
import { setDeclaredField, setVerifiedField, getProfile } from '@/lib/customer/profile-service'

beforeEach(async () => { await resetDb() })
it('re-points conversations, merges fields by provenance rule, tombstones the duplicate, frees the unique email', async () => {
  const canon = await createCustomer()
  await setVerifiedField(canon.id, 'name', 'Ion Popescu', 'document_extraction', 'ev-1')
  const dup = await createCustomer()
  await setDeclaredField(dup.id, 'name', 'Ionel Popescu', 'collect_customer_field')
  await setDeclaredField(dup.id, 'email', 'ion@example.ro', 'collect_customer_field')
  const conv = await prisma.conversation.create({ data: { customerId: dup.id } })
  const report = await claimAndMerge(dup.id, canon.id)
  expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.customerId).toBe(canon.id)
  const p = await getProfile(canon.id)
  expect(p.fields.name).toMatchObject({ provenance: 'verified', value: 'Ion Popescu' }) // verified beats declared
  expect(p.fields.email).toMatchObject({ value: 'ion@example.ro' }) // moved to canonical
  const tomb = await prisma.customer.findUnique({ where: { id: dup.id } })
  expect(tomb?.mergedIntoId).toBe(canon.id)
  expect(tomb?.email).toBeNull() // mirror cleared so canonical can hold the @unique value
  expect(report.repointed.Conversation).toBe(1)
})
it('two verified records of the same cnp merge without a spurious conflict (B0 erratum 2 — ciphertext must be decoded before matching)', async () => {
  const canon = await createCustomer()
  await setVerifiedField(canon.id, 'cnp', '1980418089861', 'document_extraction', 'ev-1')
  const dup = await createCustomer()
  await setVerifiedField(dup.id, 'cnp', '1980418089861', 'document_extraction', 'ev-2')
  const report = await claimAndMerge(dup.id, canon.id)
  expect(report.conflicts).not.toContain('cnp')
  const p = await getProfile(canon.id)
  expect(p.fields.cnp).toMatchObject({ provenance: 'verified', value: '1980******861' })
})
