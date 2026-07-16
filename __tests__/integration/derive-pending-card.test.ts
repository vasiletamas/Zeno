import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { answerAllDntQuestions } from '@/__tests__/helpers/dnt-fixtures'
import { executeCommit } from '@/lib/tools/gateway'
import { derivePendingCard } from '@/lib/chat/derive-pending-card'
import type { ToolContext } from '@/lib/tools/types'

// T9/T12 reload parity: uiActions are live-SSE-only client state, so a page
// reload mid-questionnaire loses the pending card. /chat/[id] re-derives it
// server-side — and the re-derived card must EQUAL the one the live commit
// emitted (one builder, one shape).

beforeEach(async () => { await resetDb() }, 60000)

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string) =>
  executeCommit({ tool, args, actor: 'gui', customerId, conversationId, toolContext: ctx(customerId, conversationId) })

type Card = { type: string; payload: Record<string, unknown> }
const cardOf = (r: { data?: unknown }): Card | undefined => (r.data as { _uiAction?: Card } | undefined)?._uiAction

it('DNT family: derivePendingCard equals the live open_dnt_session / write_dnt_answer emission', async () => {
  const fx = await seedMinimalProtectFixture()
  const opened = await commit('open_dnt_session', {}, fx.customerId, fx.conversationId)
  expect(opened.outcome).toBe('applied')
  const openedCard = cardOf(opened)
  expect(openedCard?.type).toBe('show_question')
  expect(await derivePendingCard(fx.conversationId)).toEqual(openedCard)

  // one answer later the pending card MOVES — the derive must track it
  const written = await commit('write_dnt_answer', { questionCode: 'DNT_CONSULTATION_CONSENT', value: 'yes_all' }, fx.customerId, fx.conversationId)
  expect(written.outcome).toBe('applied')
  const nextCard = cardOf(written)
  expect(nextCard).toBeDefined()
  expect(nextCard).not.toEqual(openedCard)
  expect(await derivePendingCard(fx.conversationId)).toEqual(nextCard)
}, 120000)

it('DNT session complete but unsigned → null (the sign confirmation is turn-scoped, and the application questionnaire is still DNT-gated)', async () => {
  const fx = await seedMinimalProtectFixture()
  const opened = await commit('open_dnt_session', {}, fx.customerId, fx.conversationId)
  expect(opened.outcome).toBe('applied')
  await answerAllDntQuestions(fx.customerId, fx.conversationId)
  expect(await derivePendingCard(fx.conversationId)).toBeNull()
}, 120000)

it('application family: derivePendingCard equals the live select_coverage entry-card emission, then goes null on completion', async () => {
  const fx = await seedMinimalProtectFixture()
  await signDntWithFacts(fx, {})
  await commit('select_coverage', { tier: 'standard' }, fx.customerId, fx.conversationId)
  const level = await commit('select_coverage', { level: 'level_1' }, fx.customerId, fx.conversationId)
  expect(level.outcome).toBe('applied')
  const entryCard = cardOf(level)
  expect(entryCard?.type).toBe('show_question')
  expect(await derivePendingCard(fx.conversationId)).toEqual(entryCard)

  // answering the last question closes the questionnaire — nothing pending
  const saved = await commit('write_question_answer', { answer: 'true', questionCode: 'HEALTH_DECLARATION_CONFIRM' }, fx.customerId, fx.conversationId)
  expect(saved.outcome).toBe('applied')
  expect(await derivePendingCard(fx.conversationId)).toBeNull()
}, 120000)

it('no session, no application → null', async () => {
  const customer = await prisma.customer.create({ data: { language: 'ro' } })
  const conv = await prisma.conversation.create({ data: { customerId: customer.id } })
  expect(await derivePendingCard(conv.id)).toBeNull()
}, 60000)
