/**
 * T26 (P5.2): the account is BORN at email verification —
 * confirm_channel_verification creates the User (role CUSTOMER, linked by
 * the @unique customerId) and de-anonymizes the customer in the SAME commit
 * transaction. Settlement's flip stays as belt-and-braces; this is the
 * moment the customer proves a channel, so this is the moment the account
 * exists.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { executeCommit } from '@/lib/tools/gateway'
import { lastMockEmailTo } from '@/lib/email/providers/mock'
import { resetFunnelTables, createCustomer } from '../helpers/test-db'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetFunnelTables() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

async function startVerification(customerId: string, conversationId: string, email: string): Promise<string> {
  const started = await executeCommit({
    tool: 'start_channel_verification', actor: 'agent', customerId, conversationId,
    args: { channel: 'email', target: email }, toolContext: ctx(customerId, conversationId),
  })
  if (started.outcome !== 'applied') throw new Error(`start_channel_verification ${started.outcome} (${started.reason})`)
  const code = lastMockEmailTo(email)?.code
  if (!code) throw new Error('no code in the mock mailbox')
  return code
}

const confirm = (customerId: string, conversationId: string, code: string) =>
  executeCommit({
    tool: 'confirm_channel_verification', actor: 'gui', customerId, conversationId,
    args: { code }, toolContext: ctx(customerId, conversationId),
  })

it('confirm_channel_verification creates the User and de-anonymizes the customer in the same commit', async () => {
  const c = await createCustomer({ isAnonymous: true })
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const code = await startVerification(c.id, conv.id, 'acct@example.ro')
  const r = await confirm(c.id, conv.id, code)
  expect(r.outcome).toBe('applied')
  expect((r.data as { accountCreated?: boolean }).accountCreated).toBe(true)

  const user = await prisma.user.findUnique({ where: { customerId: c.id } })
  expect(user).toMatchObject({ email: 'acct@example.ro', role: 'CUSTOMER' })
  const after = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
  expect(after.isAnonymous).toBe(false)
})

it('idempotent: a returning account-holder verifying again gets NO duplicate User and accountCreated=false', async () => {
  const c = await createCustomer({ isAnonymous: true })
  const conv = await prisma.conversation.create({ data: { customerId: c.id } })
  const first = await confirm(c.id, conv.id, await startVerification(c.id, conv.id, 'twice@example.ro'))
  expect(first.outcome).toBe('applied')

  const second = await confirm(c.id, conv.id, await startVerification(c.id, conv.id, 'twice@example.ro'))
  expect(second.outcome).toBe('applied')
  expect((second.data as { accountCreated?: boolean }).accountCreated).toBe(false)
  expect(await prisma.user.count({ where: { email: 'twice@example.ro' } })).toBe(1)
})

it('merged claim: the User lands on the CANONICAL owner, never the anonymous shell', async () => {
  // the owner proves the address first (and gets the account)
  const owner = await createCustomer({ isAnonymous: true })
  const conv1 = await prisma.conversation.create({ data: { customerId: owner.id } })
  const r1 = await confirm(owner.id, conv1.id, await startVerification(owner.id, conv1.id, 'owner@example.ro'))
  expect(r1.outcome).toBe('applied')

  // a fresh anonymous shell verifies the SAME address → claim-and-merge
  const shell = await createCustomer({ isAnonymous: true })
  const conv2 = await prisma.conversation.create({ data: { customerId: shell.id } })
  const r2 = await confirm(shell.id, conv2.id, await startVerification(shell.id, conv2.id, 'owner@example.ro'))
  expect(r2.outcome).toBe('applied')
  expect((r2.data as { merged?: boolean }).merged).toBe(true)
  expect((r2.data as { accountCreated?: boolean }).accountCreated).toBe(false)

  // exactly one User, linked to the owner — the shell never gets one
  const users = await prisma.user.findMany({ where: { email: 'owner@example.ro' } })
  expect(users).toHaveLength(1)
  expect(users[0].customerId).toBe(owner.id)
  expect(await prisma.user.findUnique({ where: { customerId: shell.id } })).toBeNull()
})
