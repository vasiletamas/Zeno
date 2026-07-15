import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { getNextQuestion, calculateProgress } from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
beforeEach(async () => { await resetDb() })

it('dntSession scope reads DntAnswer rows, conversation scope reads Answer rows — same engine', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const codes = await resolveGroupCodes(p.id, 'dnt')
  const first = await getNextQuestion(codes, { kind: 'dntSession', sessionId: s.id })
  expect(first).not.toBeNull()
  await prisma.dntAnswer.create({ data: { sessionId: s.id, questionId: first!.question.id, value: 'yes_all' } })
  const second = await getNextQuestion(codes, { kind: 'dntSession', sessionId: s.id })
  expect(second!.question.id).not.toBe(first!.question.id)
  expect((await calculateProgress(codes, { kind: 'dntSession', sessionId: s.id })).answered).toBe(1)
})

it('subtype gating is now enforced: simple_protection hides financial/investment/sustainability groups', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const s = await prisma.dntSession.create({ data: { customerId: c.id, productId: p.id, type: 'NEW' } })
  const codes = await resolveGroupCodes(p.id, 'dnt')
  const subtype = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_LIFE_SUBTYPE' } })
  await prisma.dntAnswer.create({ data: { sessionId: s.id, questionId: subtype.id, value: 'simple_protection' } })
  const total = (await calculateProgress(codes, { kind: 'dntSession', sessionId: s.id })).total
  expect(total).toBe(10) // 3 consent + 6 general + 1 subtype; 16 gated questions hidden
})
