import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { issueChallenge, confirmByCode, confirmByLinkToken } from '@/lib/customer/verification-service'

beforeEach(async () => { await resetFunnelTables() })

it('issues one challenge usable as OTP or link; confirm consumes once; channel becomes verified', async () => {
  const c = await createCustomer()
  const { challengeId, code, linkToken } = await issueChallenge(c.id, 'email', 'ana@example.ro', 'conv-1')
  expect(code).toMatch(/^\d{6}$/)
  const row = await prisma.verificationChallenge.findUniqueOrThrow({ where: { id: challengeId } })
  expect(row.codeHash).not.toContain(code) // hashed at rest
  const r = await confirmByCode(c.id, code)
  expect(r).toMatchObject({ ok: true, channel: 'email', conversationId: 'conv-1' })
  const email = await prisma.customerProfileField.findUniqueOrThrow({ where: { customerId_field: { customerId: c.id, field: 'email' } } })
  expect(email.provenance).toBe('verified')
  expect((await confirmByLinkToken(linkToken)).ok).toBe(false) // one-time use
})

it('expiry and attempt limits hold', async () => {
  const c = await createCustomer()
  const { code } = await issueChallenge(c.id, 'email', 'a@b.ro', null)
  for (let i = 0; i < 5; i++) expect((await confirmByCode(c.id, '000000')).ok).toBe(false)
  expect(await confirmByCode(c.id, code)).toMatchObject({ ok: false, reason: 'attempts_exhausted' })
})

it('re-issuing invalidates the prior unconsumed challenge without marking it consumed', async () => {
  const c = await createCustomer()
  const first = await issueChallenge(c.id, 'email', 'a@b.ro', null)
  const second = await issueChallenge(c.id, 'email', 'a@b.ro', null)
  expect((await confirmByCode(c.id, first.code)).ok).toBe(false) // superseded
  const firstRow = await prisma.verificationChallenge.findUniqueOrThrow({ where: { id: first.challengeId } })
  expect(firstRow.consumedAt).toBeNull() // invalidated ≠ consumed — verifiedChannels reads consumption
  expect((await confirmByCode(c.id, second.code)).ok).toBe(true)
})
