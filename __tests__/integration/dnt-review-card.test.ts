/**
 * T7 clause 5 (docs/plans/2026-07-15-design-questionnaire-ux-standard.md):
 * DNT completion ALWAYS auto-emits the review/sign card — the commit (or
 * read) that observes the last answer carries show_dnt_review in its result,
 * never model-initiated. The live defect (2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme msgs 32-38): completion returned NO uiAction, so
 * one signature cost FOUR customer interactions (prose ask, prose consent,
 * agent sign_dnt, confirm-card click).
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { getDntNextQuestion } from '@/lib/tools/handlers/dnt-handlers'
import { DNT_COMPLETION_MESSAGE } from '@/lib/tools/handlers/questionnaire-cards'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

interface ReviewAnswer {
  code: string | null
  question: { en: string; ro: string }
  value: string
  valueLabel: { en: string; ro: string } | null
}
interface ReviewCard {
  type: string
  payload: { sessionId: string; answers: ReviewAnswer[]; progress: { answered: number; total: number } }
}

const RAW_CNP = '1980418089861'

async function openSession(customerId: string, conversationId: string) {
  const opened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId, conversationId, toolContext: ctx(customerId, conversationId) })
  if (opened.outcome !== 'applied') throw new Error(`fixture open failed: ${JSON.stringify(opened)}`)
  return (opened.data as { sessionId: string }).sessionId
}

/** Answers every question through the GATEWAY and returns the LAST envelope. */
async function answerAllViaGateway(customerId: string, conversationId: string) {
  let last: Awaited<ReturnType<typeof executeCommit>> | null = null
  for (let i = 0; i < 100; i++) {
    const n = await getDntNextQuestion({}, ctx(customerId, conversationId))
    if (!n.success) throw new Error(`get_dnt_next_question failed: ${n.error}`)
    const d = n.data as { complete: boolean; question: { code: string | null; type: string; options: unknown } | null }
    if (d.complete || !d.question?.code) break
    let value = 'da'
    if (d.question.code === 'DNT_CNP') value = RAW_CNP
    else if (d.question.type === 'NUMBER') value = '0'
    else if (Array.isArray(d.question.options) && d.question.options[0]) {
      const first = d.question.options[0] as { value?: unknown } | string
      value = typeof first === 'string' ? first : String((first as { value?: unknown }).value ?? 'da')
    }
    last = await executeCommit({ tool: 'write_dnt_answer', args: { questionCode: d.question.code, value }, actor: 'gui', customerId, conversationId, toolContext: ctx(customerId, conversationId) })
    if (last.outcome !== 'applied') throw new Error(`write_dnt_answer(${d.question.code}) failed: ${JSON.stringify(last)}`)
  }
  if (!last) throw new Error('no questions were answered — is the DNT group seeded?')
  return last
}

it('the write_dnt_answer commit that answers the LAST question carries show_dnt_review (all session answers, in question order) and the completion _message', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const sessionId = await openSession(c.id, conv.id)
  const last = await answerAllViaGateway(c.id, conv.id)

  const data = last.data as { complete: boolean; _uiAction?: ReviewCard; _message?: string }
  expect(data.complete).toBe(true)
  expect(data._message).toBe(DNT_COMPLETION_MESSAGE)

  const card = data._uiAction
  expect(card?.type).toBe('show_dnt_review')
  expect(card?.payload.sessionId).toBe(sessionId)
  expect(card?.payload.progress.total).toBeGreaterThan(0)
  expect(card?.payload.progress.answered).toBe(card?.payload.progress.total)
  expect(card?.payload.answers).toHaveLength(card!.payload.progress.total)

  // in question order: the consultation consent is the first seeded question
  expect(card?.payload.answers[0].code).toBe('DNT_CONSULTATION_CONSENT')
  // option answers resolve valueLabel from the option list (card localizes)
  const consent = card!.payload.answers[0]
  expect(consent.value).toBe('yes_all')
  expect(consent.valueLabel).toMatchObject({ ro: expect.any(String), en: expect.any(String) })
  // question text is the localized object, not a pre-localized string
  expect(consent.question).toHaveProperty('ro')
  expect(consent.question).toHaveProperty('en')

  // the CNP is shown as STORED — masked, never the raw identifier
  const cnp = card!.payload.answers.find((a) => a.code === 'DNT_CNP')
  expect(cnp).toBeTruthy()
  expect(cnp!.value).toContain('*')
  expect(cnp!.value).not.toBe(RAW_CNP)
})

it('get_dnt_next_question on a complete session emits the SAME review card and the completion message', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const sessionId = await openSession(c.id, conv.id)
  await answerAllDntQuestions(c.id, conv.id)

  const r = await getDntNextQuestion({}, ctx(c.id, conv.id))
  expect(r.success).toBe(true)
  expect((r.data as { complete: boolean }).complete).toBe(true)
  expect(r.message).toBe(DNT_COMPLETION_MESSAGE)
  const card = r.uiAction as ReviewCard | undefined
  expect(card?.type).toBe('show_dnt_review')
  expect(card?.payload.sessionId).toBe(sessionId)
  expect(card?.payload.answers.length).toBeGreaterThan(0)
})

it('an all-prefilled UPDATE open_dnt_session emits the review card for the NEW session (no question left to ask)', async () => {
  const c = await createCustomer(); const p = await prisma.product.findFirstOrThrow()
  const conv1 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await openSession(c.id, conv1.id)
  await answerAllDntQuestions(c.id, conv1.id)
  const signed = await executeCommit({ tool: 'sign_dnt', args: { consent: { gdpr: true, aiDisclosure: true } }, actor: 'gui', customerId: c.id, conversationId: conv1.id, toolContext: ctx(c.id, conv1.id) })
  expect(signed.outcome).toBe('applied')

  // near-expiry → the next open is an UPDATE session, fully pre-filled
  const dnt = await prisma.dnt.findFirstOrThrow({ where: { customerId: c.id, status: 'ACTIVE' } })
  await prisma.dnt.update({ where: { id: dnt.id }, data: { validUntil: new Date(Date.now() + 5 * 86400e3) } })
  const conv2 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const reopened = await executeCommit({ tool: 'open_dnt_session', args: {}, actor: 'agent', customerId: c.id, conversationId: conv2.id, toolContext: ctx(c.id, conv2.id) })
  expect(reopened.outcome).toBe('applied')
  const data = reopened.data as { type: string; sessionId: string; nextQuestion: unknown; _uiAction?: ReviewCard; _message?: string }
  expect(data.type).toBe('UPDATE')
  expect(data.nextQuestion).toBeNull()

  const card = data._uiAction
  expect(card?.type).toBe('show_dnt_review')
  expect(card?.payload.sessionId).toBe(data.sessionId)
  expect(card?.payload.progress.answered).toBe(card?.payload.progress.total)
  // the pre-filled CNP is the stored MASK, shown as-is
  const cnp = card!.payload.answers.find((a) => a.code === 'DNT_CNP')
  expect(cnp?.value).toContain('*')
  // the message says the card is shown and forbids prose confirmation / self-sign
  expect(data._message).toContain('review card')
  expect(data._message).toContain('do NOT call sign_dnt yourself')
})
