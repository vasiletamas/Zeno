import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import type { ToolContext } from '@/lib/tools/types'

// T9/T12 clause 3: a validation/grounding/code-mismatch REJECT re-emits the
// SAME question card through the rejection envelope — the handler threads it
// as data._uiAction (gateway.ts spreads rejection data; the executor lifts
// _uiAction on ANY outcome). Live defect: a rejected answer left the customer
// with NO card at all (bare {success:false, error}).

beforeEach(async () => { await resetDb() }, 60000)

const ctx = (customerId: string, conversationId: string, actor: 'gui' | 'agent') =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: 'gui' | 'agent' = 'gui') =>
  executeCommit({ tool, args, actor, customerId, conversationId, toolContext: ctx(customerId, conversationId, actor) })

type Card = { type: string; payload: { question?: { code?: string }; progress?: { answered: number; total: number }; groupType?: string } }
const cardOf = (r: { data?: unknown }): Card | undefined => (r.data as { _uiAction?: Card } | undefined)?._uiAction

// ── application family ────────────────────────────────────────────────────

async function appFixture() {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
  await signDntWithFacts(fx, {})
  return fx
}

it('write_question_answer VALIDATION reject re-emits the current question card via the rejection envelope', async () => {
  const fx = await appFixture()
  const r = await commit('write_question_answer', { answer: 'poate' }, fx.customerId, fx.conversationId)
  expect(r.outcome).toBe('rejected')
  const card = cardOf(r)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.groupType).toBe('application')
  expect(card?.payload.question?.code).toBe('HEALTH_DECLARATION_CONFIRM')
  expect(card?.payload.progress).toEqual({ answered: 0, total: 1 })
  // nothing persisted — the tx rolled back
  expect(await prisma.answer.count({ where: { applicationId: fx.applicationId } })).toBe(0)
}, 120000)

it('write_question_answer CODE-MISMATCH reject re-emits the current question card', async () => {
  const fx = await appFixture()
  const r = await commit('write_question_answer', { answer: 'true', questionCode: 'BD_CANCER_HISTORY' }, fx.customerId, fx.conversationId)
  expect(r.outcome).toBe('rejected')
  const card = cardOf(r)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.question?.code).toBe('HEALTH_DECLARATION_CONFIRM')
}, 120000)

it('write_question_answer GROUNDING reject (agent actor, unanchored value) re-emits the current question card', async () => {
  const fx = await appFixture()
  // agent actor with ZERO customer messages: nothing grounds the value
  const r = await commit('write_question_answer', { answer: 'true' }, fx.customerId, fx.conversationId, 'agent')
  expect(r.outcome).toBe('rejected')
  expect(String((r.data as { error?: string })?.error)).toContain('value_not_grounded')
  const card = cardOf(r)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.question?.code).toBe('HEALTH_DECLARATION_CONFIRM')
}, 120000)

// ── DNT family ────────────────────────────────────────────────────────────

it('write_dnt_answer VALIDATION reject re-emits the SAME question card the session opened with', async () => {
  const fx = await seedMinimalProtectFixture()
  const opened = await commit('open_dnt_session', {}, fx.customerId, fx.conversationId)
  expect(opened.outcome).toBe('applied')
  const openedCard = cardOf(opened)
  expect(openedCard?.payload.question?.code).toBe('DNT_CONSULTATION_CONSENT')

  const r = await commit('write_dnt_answer', { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'not_a_real_option' }, fx.customerId, fx.conversationId)
  expect(r.outcome).toBe('rejected')
  // byte-identical re-emission: same question, same progress, same shape
  expect(cardOf(r)).toEqual(openedCard)
}, 120000)

it('write_dnt_answer UNKNOWN-CODE reject re-emits the current question card beside the self-heal hint', async () => {
  const fx = await seedMinimalProtectFixture()
  await commit('open_dnt_session', {}, fx.customerId, fx.conversationId)
  const r = await commit('write_dnt_answer', { questionCode: 'HEALTH_DECLARATION_CONFIRM', value: 'true' }, fx.customerId, fx.conversationId)
  expect(r.outcome).toBe('rejected')
  expect(String((r.data as { error?: string })?.error)).toContain('current unanswered question is DNT_CONSULTATION_CONSENT')
  const card = cardOf(r)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.groupType).toBe('dnt')
  expect(card?.payload.question?.code).toBe('DNT_CONSULTATION_CONSENT')
}, 120000)

it('write_dnt_answer GROUNDING reject (agent actor) re-emits the addressed question card', async () => {
  const fx = await seedMinimalProtectFixture()
  await commit('open_dnt_session', {}, fx.customerId, fx.conversationId)
  const r = await commit('write_dnt_answer', { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'yes_all' }, fx.customerId, fx.conversationId, 'agent')
  expect(r.outcome).toBe('rejected')
  expect(String((r.data as { error?: string })?.error)).toContain('value_not_grounded')
  const card = cardOf(r)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.question?.code).toBe('DNT_CONSULTATION_CONSENT')
}, 120000)
