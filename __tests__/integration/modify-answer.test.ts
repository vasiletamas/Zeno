import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { seedDntFullyAnswered } from '@/__tests__/helpers/dnt-fixtures'
import { signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { writeRevision } from '@/lib/engines/answer-store'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

async function seedOpenApplicationWithHealthAnswer() {
  const fx = await seedDntFullyAnswered()
  const signed = await signDnt({ confirmSignature: true, consent: { gdpr: true, aiDisclosure: true } }, fx.ctx)
  if (!signed.success) throw new Error(`fixture sign failed: ${signed.error}`)
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: fx.conversationId } })
  const app = await prisma.application.create({
    data: { originConversationId: fx.conversationId, customerId: fx.customerId, productId: conversation.productId!, status: 'OPEN' },
  })
  await prisma.conversation.update({ where: { id: fx.conversationId }, data: { activeApplicationId: app.id } })
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'HEALTH_DECLARATION_CONFIRM' } })
  await writeRevision(prisma, { applicationId: app.id, questionId: q.id, value: 'true', source: 'USER_ANSWER' })
  return { ...fx, applicationId: app.id, questionId: q.id }
}

it('modify_answer: CONFIRM_ON_MODIFY demands the two-step; the confirmed apply pauses via the DERIVED flag and links revisions to the ledger row', async () => {
  const fx = await seedOpenApplicationWithHealthAnswer()

  // 1. no token → requires_confirmation with a minted token and the plan preview
  const r1 = await executeCommit({ tool: 'modify_answer', args: { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'false' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx(fx.customerId, fx.conversationId) })
  expect(r1.outcome).toBe('requires_confirmation')
  expect(r1.confirmToken).toBeDefined()
  expect((r1.data as { preview: { mutation: { node: string } } }).preview.mutation.node).toBe('answer:HEALTH_DECLARATION_CONFIRM')
  // nothing was written
  expect(await prisma.answer.count({ where: { applicationId: fx.applicationId, status: 'ACTIVE' } })).toBe(1)

  // 2. confirmed → applied; the escalate flag is DERIVED from the new active
  // revision and pauses the application (erratum 10)
  const r2 = await executeCommit({ tool: 'modify_answer', args: { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'false' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, confirmToken: r1.confirmToken, toolContext: ctx(fx.customerId, fx.conversationId) })
  expect(r2.outcome).toBe('applied')
  const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
  expect(app.status).toBe('PAUSED')
  expect(app.flagsForReview).toContainEqual(expect.objectContaining({ questionCode: 'HEALTH_DECLARATION_CONFIRM', action: 'escalate' }))
  const rows = await prisma.answer.findMany({ where: { applicationId: fx.applicationId, questionId: fx.questionId }, orderBy: { answeredAt: 'asc' } })
  expect(rows.map(r => r.status)).toEqual(['SUPERSEDED', 'ACTIVE'])
  // the new revision names the ledger row that caused it (C1.5 commitId)
  const ledgerRow = await prisma.commitLedger.findFirst({ where: { conversationId: fx.conversationId, tool: 'modify_answer', outcome: 'applied' } })
  expect(rows[1].commitId).toBe(ledgerRow!.id)

  // 3. correcting back to 'true' (exposed on PAUSED — erratum 10 unpause
  // path) clears the derived flag and reopens the application
  const r3 = await executeCommit({ tool: 'modify_answer', args: { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'true' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx(fx.customerId, fx.conversationId) })
  expect(r3.outcome).toBe('requires_confirmation')
  const r4 = await executeCommit({ tool: 'modify_answer', args: { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'true' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, confirmToken: r3.confirmToken, toolContext: ctx(fx.customerId, fx.conversationId) })
  expect(r4.outcome).toBe('applied')
  const reopened = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
  expect(reopened.status).toBe('OPEN')
  expect(reopened.flagsForReview).toEqual([])
})

it('modify_answer rejects a question hidden by the current branch (bd question while the addon is off)', async () => {
  const fx = await seedOpenApplicationWithHealthAnswer()
  const r = await executeCommit({ tool: 'modify_answer', args: { questionCode: 'BD_CANCER_HISTORY', newValue: 'false' }, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx(fx.customerId, fx.conversationId) })
  expect(r).toMatchObject({ outcome: 'rejected', reason: 'removed_by_branch' })
})
