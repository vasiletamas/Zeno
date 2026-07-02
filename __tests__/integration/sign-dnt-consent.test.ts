import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { seedDntFullyAnswered } from '@/__tests__/helpers/dnt-fixtures'
beforeEach(async () => { await resetDb() })

it('signing appends gdpr_processing + ai_disclosure granted events atomically', async () => {
  const { customerId, conversationId, ctx } = await seedDntFullyAnswered()
  const r = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, ctx)
  expect(r.success).toBe(true)
  const kinds = (await prisma.consentEvent.findMany({ where: { customerId, action: 'granted' } })).map(e => e.kind).sort()
  expect(kinds).toEqual(['ai_disclosure', 'gdpr_processing'])
  expect((await prisma.conversation.findUnique({ where: { id: conversationId } }))?.dntSignedAt).not.toBeNull()
})

it('refused gdpr → no signature, no events, answers preserved (feature:209-213)', async () => {
  const { customerId, conversationId, ctx, answerCount } = await seedDntFullyAnswered()
  const r = await signDnt({ confirmSignature: true, consent: { gdpr: false, aiDisclosure: true } }, ctx)
  expect(r.success).toBe(false)
  expect(r.error).toContain('requires_consent')
  expect(await prisma.consentEvent.count({ where: { customerId } })).toBe(0)
  expect(await prisma.answer.count({ where: { conversationId } })).toBe(answerCount)
  expect((await prisma.conversation.findUnique({ where: { id: conversationId } }))?.dntSignedAt).toBeNull()
})
