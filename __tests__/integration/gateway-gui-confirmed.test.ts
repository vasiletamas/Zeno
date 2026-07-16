/**
 * T7 clause 6 (single-confirmation ruling, docs/plans/2026-07-15-design-
 * questionnaire-ux-standard.md): GUI-actor commits are confirmed by
 * construction. A GUI post originates from a card that rendered exactly the
 * args being committed — the click IS the human confirmation, so the gateway
 * neither mints a token (static gate) nor lets handlers round-trip a
 * conditional confirmation (context.confirmed=true). The agent-path
 * confirmToken two-step stays byte-identical (pinned by gateway.test.ts,
 * sign-dnt-session.test.ts, modify-answer.test.ts — and re-pinned here).
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { answerAllDntQuestions, seedDntFullyAnswered } from '@/__tests__/helpers/dnt-fixtures'
import { signDnt } from '@/lib/tools/handlers/dnt-handlers'
import { writeRevision } from '@/lib/engines/answer-store'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string, actor: 'gui' | 'agent') =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor } as unknown as ToolContext)

async function signableDnt() {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv.id, toolContext: ctx(c.id, conv.id, 'agent') })
  if (opened.outcome !== 'applied') throw new Error(`fixture open failed: ${JSON.stringify(opened)}`)
  await answerAllDntQuestions(c.id, conv.id)
  return { customerId: c.id, conversationId: conv.id }
}

it('gui sign_dnt with consent and NO token applies in ONE call — ledger row applied/actor gui, no requires_confirmation row', async () => {
  const fx = await signableDnt()
  const r = await executeCommit({
    tool: 'sign_dnt',
    args: { consent: { gdpr: true, aiDisclosure: true } },
    actor: 'gui',
    customerId: fx.customerId,
    conversationId: fx.conversationId,
    toolContext: ctx(fx.customerId, fx.conversationId, 'gui'),
  })
  expect(r.outcome).toBe('applied')
  const rows = await prisma.commitLedger.findMany({ where: { conversationId: fx.conversationId, tool: 'sign_dnt' } })
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ outcome: 'applied', actor: 'gui', idempotencyDisposition: 'fresh' })
  expect(await prisma.dnt.count({ where: { customerId: fx.customerId, status: 'ACTIVE' } })).toBe(1)
})

it('agent sign_dnt tokenless STILL requires_confirmation — the agent two-step is byte-identical', async () => {
  const fx = await signableDnt()
  const first = await executeCommit({
    tool: 'sign_dnt',
    args: { consent: { gdpr: true, aiDisclosure: true } },
    actor: 'agent',
    customerId: fx.customerId,
    conversationId: fx.conversationId,
    toolContext: ctx(fx.customerId, fx.conversationId, 'agent'),
  })
  expect(first.outcome).toBe('requires_confirmation')
  expect(first.confirmToken).toBeTruthy()
  expect(await prisma.dnt.count({ where: { customerId: fx.customerId } })).toBe(0)
})

// The conditional (plan-driven) gate: a gui modify of a CONFIRM_ON_MODIFY
// answer applies in one call because context.confirmed=true — AND the
// consequence plan still runs in full (escalate flag → PAUSED, revision
// superseded), proving the gate skip never skips the plan.
async function openApplicationWithHealthAnswer() {
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

it('gui modify_answer of a CONFIRM_ON_MODIFY answer applies WITHOUT a confirm round-trip and the consequence plan still applies', async () => {
  const fx = await openApplicationWithHealthAnswer()
  const r = await executeCommit({
    tool: 'modify_answer',
    args: { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'false' },
    actor: 'gui',
    customerId: fx.customerId,
    conversationId: fx.conversationId,
    toolContext: ctx(fx.customerId, fx.conversationId, 'gui'),
  })
  expect(r.outcome).toBe('applied')
  // no requires_confirmation row was ever minted for the gui path
  const rows = await prisma.commitLedger.findMany({ where: { conversationId: fx.conversationId, tool: 'modify_answer' } })
  expect(rows.map((row) => row.outcome)).toEqual(['applied'])
  expect(rows[0].actor).toBe('gui')
  // the plan ran: escalate flag derived → application PAUSED, revision superseded
  const app = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
  expect(app.status).toBe('PAUSED')
  expect(app.flagsForReview).toContainEqual(expect.objectContaining({ questionCode: 'HEALTH_DECLARATION_CONFIRM', action: 'escalate' }))
  const revisions = await prisma.answer.findMany({ where: { applicationId: fx.applicationId, questionId: fx.questionId }, orderBy: { answeredAt: 'asc' } })
  expect(revisions.map((row) => row.status)).toEqual(['SUPERSEDED', 'ACTIVE'])
})

it('agent modify_answer of the same CONFIRM_ON_MODIFY answer still demands the two-step', async () => {
  const fx = await openApplicationWithHealthAnswer()
  const r = await executeCommit({
    tool: 'modify_answer',
    args: { questionCode: 'HEALTH_DECLARATION_CONFIRM', newValue: 'false' },
    actor: 'agent',
    customerId: fx.customerId,
    conversationId: fx.conversationId,
    toolContext: ctx(fx.customerId, fx.conversationId, 'gui'), // gui toolContext bypasses only the grounding guard; the gateway keys on req.actor
  })
  expect(r.outcome).toBe('requires_confirmation')
  expect(r.confirmToken).toBeTruthy()
})
