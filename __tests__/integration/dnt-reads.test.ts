import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { getDntState, getDntQuestions, getDntNextQuestion } from '@/lib/tools/handlers/dnt-handlers'
import { getToolDefinition } from '@/lib/tools/registry'
beforeEach(async () => { await resetDb() })

it('get_dnt_state reports validity, coverage, expiry AND the active-session summary (absorbs session details, #7)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const ctx = { customerId: c.id, conversationId: 'conv-1', language: 'ro' as const, product: { id: p.id }, db: prisma }
  const r = await getDntState({}, ctx as never)
  expect(r.data).toMatchObject({ valid: false, productTypesCovered: [], session: { id: s.id, type: 'NEW', answered: 0 } })
})

it('get_dnt_questions previews without any session; get_dnt_next_question steps an active one', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const ctx = { customerId: c.id, conversationId: 'conv-1', language: 'ro' as const, product: { id: p.id }, db: prisma }
  const q = await getDntQuestions({}, ctx as never)
  expect((q.data!.questions as unknown[]).length).toBeGreaterThan(0)
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const n = await getDntNextQuestion({}, ctx as never)
  expect(n.data!.sessionId).toBe(s.id)
  expect(n.data!.question).toBeDefined()
})

it('legacy tools are gone', () => {
  expect(getToolDefinition('check_dnt_status')).toBeUndefined()
  expect(getToolDefinition('start_dnt_questionnaire')).toBeUndefined()
  expect(getToolDefinition('get_dnt_state')).toBeDefined()
  expect(getToolDefinition('get_dnt_questions')).toBeDefined()
  expect(getToolDefinition('get_dnt_next_question')).toBeDefined()
})
