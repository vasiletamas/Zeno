import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'
beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)
const open = (customerId: string, conversationId: string) =>
  executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId, conversationId, toolContext: ctx(customerId, conversationId) })

it('engine decides NEW for a first-timer; second open is rejected with the active id (#7)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r1 = await open(c.id, conv.id)
  expect(r1.outcome).toBe('applied')
  expect((r1.data as { type: string }).type).toBe('NEW')
  const r2 = await open(c.id, conv.id)
  expect(r2.outcome).toBe('rejected')
  expect(r2.reason).toBe('dnt_session_already_active')
})

it('write_dnt_answer is write-or-change (flat: modify never cascades)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const s = (await open(c.id, conv.id)).data as { sessionId: string }
  const w1 = await executeCommit({ tool: 'write_dnt_answer', args: { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'yes_all' }, actor: 'gui', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(w1.outcome).toBe('applied')
  const w2 = await executeCommit({ tool: 'write_dnt_answer', args: { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'no' }, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id) })
  expect(w2.outcome).toBe('applied') // change, same tool
  expect(w2.effects).toEqual([])     // flat — no cascade effects ever (T3.D6)
  const rows = await prisma.dntAnswer.findMany({ where: { sessionId: s.sessionId } })
  expect(rows).toHaveLength(1)
  expect(rows[0].value).toBe('no')
})

it('UPDATE session pre-fills by question code from the prior signed Dnt', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const prior = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW', status: 'SIGNED' } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_OCCUPATION' } })
  await prisma.dntAnswer.create({ data: { sessionId: prior.id, questionId: q.id, value: 'employee' } })
  await prisma.dnt.create({ data: { customerId: c.id, signedAt: new Date('2025-06-01'), validUntil: new Date('2026-06-20'), productTypesCovered: ['LIFE'], sourceSessionId: prior.id } })
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const r = await open(c.id, conv.id) // expiring/expired prior → UPDATE, application-free renewal (#12)
  expect((r.data as { type: string }).type).toBe('UPDATE')
  const copied = await prisma.dntAnswer.findFirst({ where: { sessionId: (r.data as { sessionId: string }).sessionId, questionId: q.id } })
  expect(copied?.value).toBe('employee')
})
