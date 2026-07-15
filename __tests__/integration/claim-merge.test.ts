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

// Merge-collision guards — a blind repoint hits a unique index when BOTH
// customers hold a colliding row, which aborts the WHOLE verification tx
// (the sim battery's shared-email case). Each guard resolves the collision
// inside the merge instead of throwing.

const insight = (customerId: string, key: string, value: string, confidence: number, lastConfirmedAt: Date, category: 'DEMOGRAPHIC' | 'PREFERENCE' = 'DEMOGRAPHIC') =>
  prisma.customerInsight.create({ data: { customerId, category, key, value, confidence, source: 'test', lastConfirmedAt } })

it('insight KEY collision: freshest lastConfirmedAt wins per key, loser row deleted, dup-only keys repointed — no throw', async () => {
  const canon = await createCustomer()
  const dup = await createCustomer()
  const old = new Date('2026-01-01T00:00:00Z')
  const fresh = new Date('2026-06-01T00:00:00Z')
  await insight(canon.id, 'age', '30', 0.9, old)
  await insight(dup.id, 'age', '31', 0.5, fresh) // dup fresher → dup wins despite lower confidence
  await insight(canon.id, 'preferredTier', 'optim', 0.6, fresh, 'PREFERENCE')
  await insight(dup.id, 'preferredTier', 'standard', 0.6, old, 'PREFERENCE') // canon fresher → canon keeps
  await insight(dup.id, 'familySize', '3', 0.7, fresh) // dup-only → plain repoint
  const report = await claimAndMerge(dup.id, canon.id)
  const byKey = Object.fromEntries((await prisma.customerInsight.findMany({ where: { customerId: canon.id } })).map(r => [r.key, r.value]))
  expect(byKey).toEqual({ age: '31', preferredTier: 'optim', familySize: '3' })
  expect(await prisma.customerInsight.count({ where: { customerId: dup.id } })).toBe(0)
  expect(report.repointed.CustomerInsight).toBe(2) // age + familySize moved; losing preferredTier row deleted
})

it('insight tie on lastConfirmedAt → higher confidence wins; equal confidence keeps the canonical row', async () => {
  const canon = await createCustomer()
  const dup = await createCustomer()
  const t = new Date('2026-06-01T00:00:00Z')
  await insight(canon.id, 'age', '30', 0.4, t)
  await insight(dup.id, 'age', '31', 0.9, t) // tie on time → dup's higher confidence wins
  await insight(canon.id, 'familySize', '2', 0.5, t)
  await insight(dup.id, 'familySize', '4', 0.5, t) // full tie → canonical stays
  await claimAndMerge(dup.id, canon.id)
  const byKey = Object.fromEntries((await prisma.customerInsight.findMany({ where: { customerId: canon.id } })).map(r => [r.key, r.value]))
  expect(byKey).toEqual({ age: '31', familySize: '2' })
  expect(await prisma.customerInsight.count({ where: { customerId: dup.id } })).toBe(0)
})

it('open Application collision on the same product: the in-flight duplicate application survives OPEN; the canonical stale one is CANCELLED', async () => {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const canon = await createCustomer()
  const dup = await createCustomer()
  const stale = await prisma.application.create({ data: { customerId: canon.id, productId: product.id, status: 'OPEN' } })
  const live = await prisma.application.create({ data: { customerId: dup.id, productId: product.id, status: 'OPEN' } })
  await claimAndMerge(dup.id, canon.id)
  const liveAfter = await prisma.application.findUniqueOrThrow({ where: { id: live.id } })
  expect(liveAfter.customerId).toBe(canon.id)
  expect(liveAfter.status).toBe('OPEN') // the conversation's activeApplicationId keeps working
  expect((await prisma.application.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('CANCELLED')
})

it('ACTIVE DntSession collision: the duplicate live session survives ACTIVE; the canonical stale one is CANCELLED', async () => {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const canon = await createCustomer()
  const dup = await createCustomer()
  const stale = await prisma.dntSession.create({ data: { customerId: canon.id, productId: product.id, type: 'NEW', status: 'ACTIVE' } })
  const live = await prisma.dntSession.create({ data: { customerId: dup.id, productId: product.id, type: 'NEW', status: 'ACTIVE' } })
  await claimAndMerge(dup.id, canon.id)
  const liveAfter = await prisma.dntSession.findUniqueOrThrow({ where: { id: live.id } })
  expect(liveAfter.customerId).toBe(canon.id)
  expect(liveAfter.status).toBe('ACTIVE')
  expect((await prisma.dntSession.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe('CANCELLED')
})
