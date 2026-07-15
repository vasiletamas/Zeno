import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

// Task 2.1 (D1): the DNT card path end-to-end — open_dnt_session /
// write_dnt_answer results carrying a next question emit the show_question
// card, and gui-actor card answers land (or bounce) at the SAME server
// boundary the agent path uses (validateAnswer stays authoritative).

beforeEach(async () => { await resetDb() }, 60000)

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma } as unknown as ToolContext)

async function openSession(fx: { customerId: string; conversationId: string }) {
  return executeCommit({
    tool: 'open_dnt_session', actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId,
    args: {}, toolContext: ctx(fx.customerId, fx.conversationId),
  })
}

const writeAnswer = (fx: { customerId: string; conversationId: string }, questionCode: string, value: string) =>
  executeCommit({
    tool: 'write_dnt_answer', actor: 'gui', customerId: fx.customerId, conversationId: fx.conversationId,
    args: { questionCode, value }, toolContext: { ...ctx(fx.customerId, fx.conversationId), actor: 'gui' } as ToolContext,
  })

type UiAction = { type: string; payload: { question?: { code?: string; text?: { en: string; ro: string }; options?: unknown }; progress?: { answered: number; total: number }; groupType?: string } }
const uiActionOf = (r: { data?: unknown }): UiAction | undefined => (r.data as { _uiAction?: UiAction } | undefined)?._uiAction

it('open_dnt_session emits a show_question card for the first pending question', async () => {
  const fx = await seedMinimalProtectFixture()
  const r = await openSession(fx)
  expect(r.outcome).toBe('applied')
  const ui = uiActionOf(r)
  expect(ui?.type).toBe('show_question')
  expect(ui?.payload.groupType).toBe('dnt')
  expect(ui?.payload.question?.code).toBe('DNT_CONSULTATION_CONSENT')
  // card-ready localized text, not a pre-localized string
  expect(ui?.payload.question?.text).toHaveProperty('ro')
  expect(ui?.payload.progress?.total).toBeGreaterThan(0)
}, 60000)

it('gui-actor card answer with a valid option value → applied, next card emitted, actor recorded', async () => {
  const fx = await seedMinimalProtectFixture()
  await openSession(fx)
  const r = await writeAnswer(fx, 'DNT_CONSULTATION_CONSENT', 'yes_all')
  expect(r.outcome).toBe('applied')
  const ui = uiActionOf(r)
  expect(ui?.type).toBe('show_question')
  expect(ui?.payload.question?.code).toBeTruthy()
  expect(ui?.payload.question?.code).not.toBe('DNT_CONSULTATION_CONSENT')
  const row = await prisma.commitLedger.findFirst({ where: { conversationId: fx.conversationId, tool: 'write_dnt_answer', outcome: 'applied' } })
  expect(row?.actor).toBe('gui')
}, 60000)

// Task 2.2 hole (2026-07-06 battery): the turn that CALLS open_dnt_session
// started pre-DNT, so the never-enumerate rule from the DNT context section
// was not in the prompt yet and the model listed "Opțiuni:" in prose. The
// instruction must ride the tool result the model reads before narrating.
it('open_dnt_session and write_dnt_answer results carry the no-prose-enumeration instruction', async () => {
  const fx = await seedMinimalProtectFixture()
  const opened = await openSession(fx)
  expect(String((opened.data as { _message?: string })?._message)).toMatch(/never (list|enumerate) the options/i)
  const r = await writeAnswer(fx, 'DNT_CONSULTATION_CONSENT', 'yes_all')
  expect(String((r.data as { _message?: string })?._message)).toMatch(/never (list|enumerate) the options/i)
}, 60000)

it('NEGATIVE: a value outside the options → rejected envelope, nothing persisted', async () => {
  const fx = await seedMinimalProtectFixture()
  await openSession(fx)
  const r = await writeAnswer(fx, 'DNT_CONSULTATION_CONSENT', 'not_a_real_option')
  expect(r.outcome).toBe('rejected')
  const q = await prisma.question.findFirstOrThrow({ where: { code: 'DNT_CONSULTATION_CONSENT' } })
  expect(await prisma.dntAnswer.findFirst({ where: { questionId: q.id } })).toBeNull()
}, 60000)

it('NEGATIVE: a stale/unknown questionCode → rejected with the current unanswered question named', async () => {
  const fx = await seedMinimalProtectFixture()
  await openSession(fx)
  const r = await writeAnswer(fx, 'HEALTH_DECLARATION_CONFIRM', 'true') // an application code, not a DNT one
  expect(r.outcome).toBe('rejected')
  expect(String((r.data as { error?: string })?.error)).toContain('current unanswered question is DNT_CONSULTATION_CONSENT')
}, 60000)
