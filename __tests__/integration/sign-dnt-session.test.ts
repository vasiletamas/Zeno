import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures'
import type { ToolContext } from '@/lib/tools/types'
beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

const signViaGateway = async (customerId: string, conversationId: string, consent: { gdpr: boolean; aiDisclosure: boolean }) => {
  const first = await executeCommit({ tool: 'sign_dnt', args: { consent }, actor: 'agent', customerId, conversationId, toolContext: ctx(customerId, conversationId) })
  if (first.outcome !== 'requires_confirmation' || !first.confirmToken) return first
  return executeCommit({ tool: 'sign_dnt', args: { consent, confirmToken: first.confirmToken }, actor: 'agent', customerId, conversationId, toolContext: ctx(customerId, conversationId) })
}

it('signing creates the customer-scoped Dnt (365d, coverage computed), marks session SIGNED, appends consents, supersedes the prior Dnt', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  await answerAllDntQuestions(c.id, conv.id)
  const r = await signViaGateway(c.id, conv.id, { gdpr: true, aiDisclosure: true })
  expect(r.outcome).toBe('applied')
  const dnt = await prisma.dnt.findFirstOrThrow({ where: { customerId: c.id, status: 'ACTIVE' } })
  expect(dnt.productTypesCovered).toEqual(['LIFE'])
  expect(dnt.validUntil.getTime() - dnt.signedAt.getTime()).toBe(365 * 86400e3)
  expect((await prisma.dntSession.findUniqueOrThrow({ where: { id: dnt.sourceSessionId } })).status).toBe('SIGNED')
  expect(await prisma.consentEvent.count({ where: { customerId: c.id, action: 'granted' } })).toBeGreaterThanOrEqual(2)

  // renewal: expire the Dnt, open UPDATE without an application, sign again → prior SUPERSEDED
  await prisma.dnt.update({ where: { id: dnt.id }, data: { validUntil: new Date(Date.now() + 5 * 86400e3) } })
  const conv2 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const reopened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv2.id, toolContext: ctx(c.id, conv2.id) })
  expect(reopened.outcome).toBe('applied')
  expect((reopened.data as { type: string }).type).toBe('UPDATE')
  const r2 = await signViaGateway(c.id, conv2.id, { gdpr: true, aiDisclosure: true })
  expect(r2.outcome).toBe('applied')
  expect((await prisma.dnt.findUniqueOrThrow({ where: { id: dnt.id } })).status).toBe('SUPERSEDED')
  expect(await prisma.dnt.count({ where: { customerId: c.id, status: 'ACTIVE' } })).toBe(1)
})

it('incomplete session → rejected(dnt_session_incomplete); refused consent → requires_consent, session intact', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  const r1 = await signViaGateway(c.id, conv.id, { gdpr: true, aiDisclosure: true })
  expect(r1).toMatchObject({ outcome: 'rejected', reason: 'dnt_session_incomplete' })
  await answerAllDntQuestions(c.id, conv.id)
  const r2 = await signViaGateway(c.id, conv.id, { gdpr: false, aiDisclosure: true })
  expect(r2.outcome).toBe('requires_consent')
  expect((await prisma.dntSession.findFirstOrThrow({ where: { customerId: c.id } })).status).toBe('ACTIVE') // preserved
})
