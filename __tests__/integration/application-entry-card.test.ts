import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, createCustomer, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { CONDUCT_LINE } from '@/lib/tools/handlers/questionnaire-cards'
import type { ToolContext } from '@/lib/tools/types'

// T9/T12 clause 1: the application questionnaire's ENTRY card rides the
// select_coverage commit that COMPLETES the selection (tier+level chosen) —
// nothing else emits the first application question (get_next_question is a
// data-only read, set_application emits nothing). Live defect: conv
// cmrm3fgku00056g0y4eb2hsme msg 41 delivered HEALTH_DECLARATION_CONFIRM
// prose-only.

beforeEach(async () => { await resetDb() }, 60000)

const ctx = (customerId: string, conversationId: string, actor: 'gui' | 'agent' = 'gui') =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string) =>
  executeCommit({ tool, args, actor: 'gui', customerId, conversationId, toolContext: ctx(customerId, conversationId) })

type Card = { type: string; payload: { question?: { code?: string; validationRules?: unknown }; conditions?: { code: string; value: string | null }[]; progress?: { answered: number; total: number }; groupType?: string } }
const cardOf = (r: { data?: unknown }): Card | undefined => (r.data as { _uiAction?: Card } | undefined)?._uiAction
const msgOf = (r: { data?: unknown }): string => String((r.data as { _message?: string } | undefined)?._message ?? '')

async function openAppWithDnt() {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const conv = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  const opened = await commit('set_application', {}, c.id, conv.id)
  if (opened.outcome !== 'applied') throw new Error(`set_application: ${JSON.stringify(opened)}`)
  await signDntWithFacts({ customerId: c.id, conversationId: conv.id }, {})
  return { c, conv }
}

it('the select_coverage commit that COMPLETES the selection carries the first question card + conduct line; the incomplete one does not', async () => {
  const { c, conv } = await openAppWithDnt()

  // tier alone leaves the level unchosen — selection incomplete, no card
  const tier = await commit('select_coverage', { tier: 'standard' }, c.id, conv.id)
  expect(tier.outcome).toBe('applied')
  expect(cardOf(tier)).toBeUndefined()
  expect(msgOf(tier)).not.toContain(CONDUCT_LINE)

  // the level completes the selection — the entry card rides THIS commit
  const level = await commit('select_coverage', { level: 'level_1' }, c.id, conv.id)
  expect(level.outcome).toBe('applied')
  const card = cardOf(level)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.groupType).toBe('application')
  expect(card?.payload.question?.code).toBe('HEALTH_DECLARATION_CONFIRM')
  // unified card shape: the application payload carries validationRules too
  expect(card?.payload.question?.validationRules).toBeDefined()
  expect(card?.payload.progress).toEqual({ answered: 0, total: 1 })
  // selection summary + the clause-2 conduct line
  expect(msgOf(level)).toContain('Selection updated: standard / level_1 / addon off.')
  expect(msgOf(level)).toContain(CONDUCT_LINE)
}, 120000)

it('selection complete but questionnaire ALREADY complete → no card, message unchanged; re-expanding via the addon emits the BD entry card', async () => {
  const { c, conv } = await openAppWithDnt()
  await commit('select_coverage', { tier: 'standard' }, c.id, conv.id)
  await commit('select_coverage', { level: 'level_1' }, c.id, conv.id)
  const saved = await commit('write_question_answer', { answer: 'true', questionCode: 'HEALTH_DECLARATION_CONFIRM' }, c.id, conv.id)
  expect(saved.outcome).toBe('applied')

  // level change with the questionnaire complete: no card, bare summary
  const relevel = await commit('select_coverage', { level: 'level_2' }, c.id, conv.id)
  expect(relevel.outcome).toBe('applied')
  expect(cardOf(relevel)).toBeUndefined()
  expect(msgOf(relevel)).toBe('Selection updated: standard / level_2 / addon off.')

  // the addon toggle re-opens the questionnaire (BD questions) — card rides.
  // T10: a BD_* next question emits the ONE batch card, never per-question.
  const addon = await commit('select_coverage', { addon: true }, c.id, conv.id)
  expect(addon.outcome).toBe('applied')
  const card = cardOf(addon)
  expect(card?.type).toBe('show_medical_batch')
  expect(card?.payload.conditions?.map((x) => x.code)).toEqual([
    'BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT',
  ])
  expect(msgOf(addon)).toContain(CONDUCT_LINE)
}, 120000)

it('resume_application emits the pending question card (clause 1 covers every questionnaire entry point)', async () => {
  const c = await createCustomer()
  const p = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })
  const conv1 = await prisma.conversation.create({ data: { customerId: c.id, candidateProductId: p.id } })
  await commit('set_application', {}, c.id, conv1.id)

  const conv2 = await prisma.conversation.create({ data: { customerId: c.id } })
  const r = await commit('resume_application', {}, c.id, conv2.id)
  expect(r.outcome).toBe('applied')
  const card = cardOf(r)
  expect(card?.type).toBe('show_question')
  expect(card?.payload.groupType).toBe('application')
  expect(card?.payload.question?.code).toBe('HEALTH_DECLARATION_CONFIRM')
  expect(msgOf(r)).toContain(CONDUCT_LINE)
}, 120000)
