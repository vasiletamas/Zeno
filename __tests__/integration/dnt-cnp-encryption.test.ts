import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { openDntSession, writeDntAnswer } from '@/lib/tools/handlers/dnt-handlers'
import type { ToolContext } from '@/lib/tools/types'

// Task 5.4 (D11): the CNP is a regulatory identifier — it must live
// encrypted in DntAnswer.value (same AES envelope as the profile mirror)
// and NEVER appear raw in derived facts or persisted snapshots.

const CNP = '1960229410015'

beforeEach(async () => { await resetDb() }, 60000)

const ctx = (fx: { customerId: string; conversationId: string }) =>
  ({ customerId: fx.customerId, conversationId: fx.conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

it('write CNP → DntAnswer holds the AES envelope, not plaintext; the profile mirror still lands', async () => {
  const fx = await seedMinimalProtectFixture()
  await openDntSession({}, ctx(fx))
  const r = await writeDntAnswer({ questionCode: 'DNT_CNP', value: CNP }, ctx(fx))
  expect(r.success).toBe(true)

  const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_CNP' } })
  const row = await prisma.dntAnswer.findFirstOrThrow({ where: { questionId: q.id } })
  expect(row.value).not.toContain(CNP)
  expect(JSON.parse(row.value)).toHaveProperty('encrypted')

  // B0 mirror: the declared cnp profile fact (encrypted its own way) still lands
  const profile = await prisma.customerProfileField.findUnique({ where: { customerId_field: { customerId: fx.customerId, field: 'cnp' } } })
  expect(profile).not.toBeNull()
}, 60000)

it('signed dnt.facts carry a MASKED cnp; eligibility facts still derive age + residency', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, { DNT_CNP: CNP })

  const snap = await loadDomainSnapshot(fx.conversationId)
  expect(JSON.stringify(snap.dnt.facts)).not.toContain(CNP)
  expect(snap.dnt.facts.DNT_CNP).toBe('1960******015')
  // decrypt path intact: age from the CNP-mirrored profile, residency from the declared cnp
  expect(snap.eligibilityFacts.residency).toBe('Romania')
  expect(typeof snap.eligibilityFacts.age).toBe('number')
}, 60000)

it('an UPDATE session pre-fills the CNP correctly through the decrypt path', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, { DNT_CNP: CNP })
  // expire the DNT so the next open decides UPDATE
  await prisma.dnt.updateMany({ where: { customerId: fx.customerId }, data: { validUntil: new Date(Date.now() + 5 * 86400e3) } })

  const opened = await openDntSession({}, ctx(fx))
  expect(opened.success).toBe(true)
  expect((opened.data as { type?: string }).type).toBe('UPDATE')
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_CNP' } })
  const session = await prisma.dntSession.findFirstOrThrow({ where: { customerId: fx.customerId, status: 'ACTIVE' } })
  const prefilled = await prisma.dntAnswer.findUnique({ where: { sessionId_questionId: { sessionId: session.id, questionId: q.id } } })
  // pre-filled AND re-encrypted — never dropped, never plaintext
  expect(prefilled).not.toBeNull()
  expect(prefilled!.value).not.toContain(CNP)
  expect(JSON.parse(prefilled!.value)).toHaveProperty('encrypted')
}, 60000)
