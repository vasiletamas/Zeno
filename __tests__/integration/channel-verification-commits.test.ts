import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetFunnelTables, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { setDeclaredField } from '@/lib/customer/profile-service'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

/** The mock email provider records its last send on globalThis for tests. */
function lastIssuedCode(): string {
  const email = (globalThis as Record<string, unknown>).__lastMockEmail as { subject: string } | undefined
  const m = email?.subject.match(/\b(\d{6})\b/)
  if (!m) throw new Error('no code found in the last mock email')
  return m[1]
}

it('start issues a challenge without disclosing whether the target matches an existing account (anti-enumeration, T4.D4)', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await executeCommit({
    tool: 'start_channel_verification', actor: 'agent', customerId: c.id, conversationId: conv.id,
    args: { channel: 'email', target: 'victim@example.ro' }, toolContext: ctx(c.id, conv.id),
  })
  expect(r.outcome).toBe('applied')
  expect(JSON.stringify(r.data)).not.toMatch(/exists|found|match/i)
})

it('confirm verifies the channel; when the target belongs to another customer it claim-and-merges the anonymous shell INTO the verified owner', async () => {
  const owner = await createCustomer({ email: 'ana@example.ro', isAnonymous: false })
  await setDeclaredField(owner.id, 'email', 'ana@example.ro', 'seed')
  const shell = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: shell.id } })
  await executeCommit({
    tool: 'start_channel_verification', actor: 'agent', customerId: shell.id, conversationId: conv.id,
    args: { channel: 'email', target: 'ana@example.ro' }, toolContext: ctx(shell.id, conv.id),
  })
  const ch = await prisma.verificationChallenge.findFirstOrThrow({ where: { customerId: shell.id } })
  const code = lastIssuedCode()
  const r = await executeCommit({
    tool: 'confirm_channel_verification', actor: 'gui', customerId: shell.id, conversationId: conv.id,
    args: { code }, toolContext: ctx(shell.id, conv.id),
  })
  expect(r.outcome).toBe('applied')
  expect((r.data as { customerId: string }).customerId).toBe(owner.id) // session rebinds to the canonical customer
  expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).customerId).toBe(owner.id)
  expect((await prisma.customer.findUniqueOrThrow({ where: { id: shell.id } })).mergedIntoId).toBe(owner.id)
  expect(ch.conversationId).toBe(conv.id)
})

it('confirm verifies in place when nobody else owns the target; tier climbs to verified_channel', async () => {
  const c = await createCustomer()
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  await setDeclaredField(c.id, 'name', 'Ana Pop', 'test')
  await setDeclaredField(c.id, 'cnp', '1980418089861', 'test')
  await setDeclaredField(c.id, 'dateOfBirth', '1998-04-18', 'test')
  await setDeclaredField(c.id, 'phone', '0712345678', 'test')
  await executeCommit({
    tool: 'start_channel_verification', actor: 'agent', customerId: c.id, conversationId: conv.id,
    args: { channel: 'email', target: 'solo@example.ro' }, toolContext: ctx(c.id, conv.id),
  })
  const r = await executeCommit({
    tool: 'confirm_channel_verification', actor: 'gui', customerId: c.id, conversationId: conv.id,
    args: { code: lastIssuedCode() }, toolContext: ctx(c.id, conv.id),
  })
  expect(r.outcome).toBe('applied')
  expect((r.data as { merged?: boolean }).merged).toBeUndefined()
  const { loadDomainSnapshot } = await import('@/lib/engines/snapshot-loader')
  const snap = await loadDomainSnapshot(conv.id)
  expect(snap.identity.tier).toBe('verified_channel')
  expect(snap.identity.verifiedChannels).toContain('email')
})
