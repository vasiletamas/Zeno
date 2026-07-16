/**
 * T10 (docs/plans/2026-07-15-design-questionnaire-ux-standard.md §"Medical
 * batch", ruling: option c): the six BD_* conditions render as ONE card
 * (show_medical_batch) whose primary action answers all six No; toggles
 * handle exceptions. Writes go through write_medical_batch — one gateway
 * commit applying the per-question consequence plans SEQUENTIALLY on
 * context.db (flag/escalation/eligibility parity with the sequential path),
 * ledgered once with targetRef app_answers_batch:<applicationId>. The signed
 * affirmation stays sign_medical_declarations over the same revision hash —
 * the batch card answers, the review card confirms. The typed per-question
 * fallback (write_question_answer) stays.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { deriveAndExpose } from '@/lib/engines/derive-and-expose'
import { loadDomainSnapshot } from '@/lib/engines/snapshot-loader'
import { loadMedicalDeclarationState } from '@/lib/engines/medical-declaration-state'
import { derivePendingCard } from '@/lib/chat/derive-pending-card'
import { MEDICAL_COMPLETION_MESSAGE, APPLICATION_COMPLETION_MESSAGE } from '@/lib/tools/handlers/questionnaire-cards'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() }, 60000)

const BD_CODES = ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT']
const ALL_FALSE: Record<string, string> = Object.fromEntries(BD_CODES.map((c) => [c, 'false']))

const ctx = (customerId: string, conversationId: string, actor: 'gui' | 'agent' = 'gui') =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor } as unknown as ToolContext)

const commit = (tool: string, args: Record<string, unknown>, customerId: string, conversationId: string, actor: 'gui' | 'agent' = 'gui') =>
  executeCommit({ tool, args, actor, customerId, conversationId, toolContext: ctx(customerId, conversationId, actor) })

interface BatchCard {
  type: string
  payload: {
    applicationId?: string
    conditions?: { code: string; question: { en: string; ro: string }; value: string | null }[]
    progress?: { answered: number; total: number }
    declarations?: { code: string; value: string }[]
  }
}
const cardOf = (r: { data?: unknown }): BatchCard | undefined => (r.data as { _uiAction?: BatchCard } | undefined)?._uiAction
const msgOf = (r: { data?: unknown }): string => String((r.data as { _message?: string } | undefined)?._message ?? '')

/** addon-on fixture with the DNT signed — pending question: HEALTH_DECLARATION_CONFIRM, then the 6 BD codes. */
async function addonFixture() {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
  await signDntWithFacts(fx, {})
  return fx
}

/** answers HEALTH_DECLARATION_CONFIRM so the pending set is exactly the 6 BD codes; returns that commit. */
async function answerHealth(fx: { customerId: string; conversationId: string }) {
  const r = await commit('write_question_answer', { answer: 'true', questionCode: 'HEALTH_DECLARATION_CONFIRM' }, fx.customerId, fx.conversationId)
  if (r.outcome !== 'applied') throw new Error(`HEALTH answer failed: ${JSON.stringify(r)}`)
  return r
}

// ── card emission: the BD entry rides the commit as ONE batch card ─────────

it('the write_question_answer that lands on a BD_* next question emits show_medical_batch (all six, unanswered=null) and reload re-derives the SAME card', async () => {
  const fx = await addonFixture()
  const saved = await answerHealth(fx)

  const card = cardOf(saved)
  expect(card?.type).toBe('show_medical_batch')
  expect(card?.payload.applicationId).toBe(fx.applicationId)
  expect(card?.payload.conditions?.map((c) => c.code)).toEqual(BD_CODES)
  for (const c of card?.payload.conditions ?? []) {
    expect(c.question).toHaveProperty('ro')
    expect(c.question).toHaveProperty('en')
    expect(c.value).toBeNull()
  }
  expect(card?.payload.progress).toEqual({ answered: 1, total: 7 })

  // T22 reload parity: the re-derived pending card equals the live emission
  expect(await derivePendingCard(fx.conversationId)).toEqual(card)
}, 120000)

// ── exposure: exactly while the pending questions are BD_* ────────────────

it('write_medical_batch is exposed only when the pending question is BD_* (before: not exposed; after the batch: gone)', async () => {
  const fx = await addonFixture()

  // pending = HEALTH_DECLARATION_CONFIRM (non-BD): the batch tool is absent
  const before = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(before.actions.available).toContain('write_question_answer')
  expect(before.actions.available).not.toContain('write_medical_batch')

  await answerHealth(fx)
  const pendingBd = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(pendingBd.actions.available).toContain('write_medical_batch')
  // typed fallback stays exposed beside it
  expect(pendingBd.actions.available).toContain('write_question_answer')

  const batch = await commit('write_medical_batch', { answers: ALL_FALSE }, fx.customerId, fx.conversationId)
  expect(batch.outcome).toBe('applied')
  const after = deriveAndExpose(await loadDomainSnapshot(fx.conversationId))
  expect(after.actions.available).not.toContain('write_medical_batch')
}, 120000)

// ── (a) all-false batch completes the questionnaire, review card rides ────

it('all-false batch (gui, ONE commit) answers all six, completes the questionnaire and carries the show_medical_review card + T11 message', async () => {
  const fx = await addonFixture()
  await answerHealth(fx)

  const batch = await commit('write_medical_batch', { answers: ALL_FALSE }, fx.customerId, fx.conversationId)
  expect(batch.outcome).toBe('applied')
  const data = batch.data as { isComplete?: boolean; readyForQuote?: boolean }
  expect(data.isComplete).toBe(true)
  expect(data.readyForQuote).toBe(true)
  expect(msgOf(batch)).toBe(MEDICAL_COMPLETION_MESSAGE)

  const review = cardOf(batch)
  expect(review?.type).toBe('show_medical_review')
  expect(review?.payload.declarations?.map((d) => d.code).sort()).toEqual([...BD_CODES].sort())
  for (const d of review?.payload.declarations ?? []) expect(d.value).toBe('false')

  // ONE ledger row, batch-scoped targetRef
  const rows = await prisma.commitLedger.findMany({ where: { conversationId: fx.conversationId, tool: 'write_medical_batch' } })
  expect(rows).toHaveLength(1)
  expect(rows[0].targetRef).toBe(`app_answers_batch:${fx.applicationId}`)
  expect(rows[0].outcome).toBe('applied')

  // per-question semantics: six ACTIVE revisions, one per BD code
  const answers = await prisma.answer.findMany({ where: { applicationId: fx.applicationId, status: 'ACTIVE' }, include: { question: { select: { code: true } } } })
  const bdValues = Object.fromEntries(answers.filter((a) => a.question.code?.startsWith('BD_')).map((a) => [a.question.code, a.value]))
  expect(bdValues).toEqual(ALL_FALSE)

  // the SIGNED affirmation stays sign_medical_declarations over the same revision set
  const signed = await commit('sign_medical_declarations', {}, fx.customerId, fx.conversationId)
  expect(signed.outcome).toBe('applied')
  expect(await prisma.medicalDeclarationSignature.count({ where: { applicationId: fx.applicationId } })).toBe(1)
}, 120000)

// ── (b) parity: mixed batch ≡ sequential write_question_answer path ───────

it('PARITY: one batch with a true ≡ six sequential write_question_answer — same Application row, same revisions, same medical state hash', async () => {
  const MIXED: Record<string, string> = { ...ALL_FALSE, BD_CARDIOVASCULAR: 'true' }

  // sequential fixture: engine-ordered write_question_answer per BD code —
  // the CARDIOVASCULAR 'true' flips the addon (ELIGIBILITY edges) and removes
  // the remaining BD questions, so later writes never happen.
  const seq = await addonFixture()
  await answerHealth(seq)
  let seqLast: Awaited<ReturnType<typeof executeCommit>> | null = null
  for (const code of BD_CODES) {
    const r = await commit('write_question_answer', { answer: MIXED[code], questionCode: code }, seq.customerId, seq.conversationId)
    if (r.outcome !== 'applied') break // questionnaire closed / code no longer current — the sequential path stops here
    seqLast = r
    if ((r.data as { isComplete?: boolean }).isComplete) break
  }
  expect(seqLast).not.toBeNull()

  // batch fixture: the same values in ONE commit
  const bat = await addonFixture()
  await answerHealth(bat)
  const batch = await commit('write_medical_batch', { answers: MIXED }, bat.customerId, bat.conversationId)
  expect(batch.outcome).toBe('applied')

  // Application row parity
  const seqApp = await prisma.application.findUniqueOrThrow({ where: { id: seq.applicationId } })
  const batApp = await prisma.application.findUniqueOrThrow({ where: { id: bat.applicationId } })
  expect(batApp.status).toBe(seqApp.status)
  expect(batApp.includesAddon).toBe(seqApp.includesAddon)
  expect(batApp.includesAddon).toBe(false) // the ELIGIBILITY edge fired in both
  expect(batApp.flagsForReview).toEqual(seqApp.flagsForReview)
  expect(batApp.currentQuestionIndex).toBe(seqApp.currentQuestionIndex)

  // revision parity: code → (value, status) over ALL revisions (sorted
  // deterministically — answeredAt can tie inside one transaction)
  const revisionsOf = async (applicationId: string) => {
    const rows = await prisma.answer.findMany({ where: { applicationId }, include: { question: { select: { code: true } } } })
    return rows
      .map((r) => ({ code: r.question.code, value: r.value, status: r.status }))
      .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '') || a.status.localeCompare(b.status))
  }
  expect(await revisionsOf(bat.applicationId)).toEqual(await revisionsOf(seq.applicationId))

  // medical state parity — addon off leaves NO required declarations in both;
  // the empty-ref hash is deterministic, so the hashes are directly equal
  const seqMed = await loadMedicalDeclarationState(prisma, seqApp)
  const batMed = await loadMedicalDeclarationState(prisma, batApp)
  expect(batMed.requiredCodes).toEqual(seqMed.requiredCodes)
  expect(batMed.answeredCodes).toEqual(seqMed.answeredCodes)
  expect(batMed.signed).toBe(seqMed.signed)
  expect(batMed.currentHash).toBe(seqMed.currentHash)

  // both completions speak the NO-pending-medical message (addon off → no declarations)
  expect(msgOf(batch)).toBe(APPLICATION_COMPLETION_MESSAGE)
  expect(msgOf(seqLast!)).toBe(APPLICATION_COMPLETION_MESSAGE)
}, 180000)

// ── (c) rejects re-emit the batch card through the rejection envelope ─────

it('a non-BD / unknown code rejects invalid_args and re-emits the SAME batch card via data._uiAction (clause 3)', async () => {
  const fx = await addonFixture()
  const entry = await answerHealth(fx)
  const entryCard = cardOf(entry)

  for (const badKey of ['HEALTH_DECLARATION_CONFIRM', 'BD_BOGUS']) {
    const r = await commit('write_medical_batch', { answers: { ...ALL_FALSE, [badKey]: 'false' } }, fx.customerId, fx.conversationId)
    expect(r.outcome).toBe('rejected')
    expect(r.reason).toBe('invalid_args')
    // byte-identical re-emission: the tx rolled back, nothing moved
    expect(cardOf(r)).toEqual(entryCard)
  }
  // nothing persisted for the BD codes
  const bd = await prisma.answer.count({ where: { applicationId: fx.applicationId, question: { code: { startsWith: 'BD_' } } } })
  expect(bd).toBe(0)
}, 120000)

// ── partial batch: the next-card is the batch card with values pre-filled ──

it('a partial batch stays incomplete and re-emits the batch card with the answered value pre-toggled', async () => {
  const fx = await addonFixture()
  await answerHealth(fx)

  const partial = await commit('write_medical_batch', { answers: { BD_CANCER_HISTORY: 'false' } }, fx.customerId, fx.conversationId)
  expect(partial.outcome).toBe('applied')
  expect((partial.data as { isComplete?: boolean }).isComplete).toBe(false)
  const card = cardOf(partial)
  expect(card?.type).toBe('show_medical_batch')
  const byCode = Object.fromEntries((card?.payload.conditions ?? []).map((c) => [c.code, c.value]))
  expect(byCode.BD_CANCER_HISTORY).toBe('false')
  expect(byCode.BD_CARDIOVASCULAR).toBeNull()
  expect(card?.payload.progress).toEqual({ answered: 2, total: 7 })
}, 120000)

// ── modify two-step: agent needs the confirm round-trip, gui is confirmed ──

it('re-answering an already-answered BD code: agent gets requires_confirmation BEFORE any write; gui applies in one call', async () => {
  const fx = await addonFixture()
  await answerHealth(fx)
  const first = await commit('write_medical_batch', { answers: { BD_CANCER_HISTORY: 'false' } }, fx.customerId, fx.conversationId)
  expect(first.outcome).toBe('applied')

  const agentModify = await commit('write_medical_batch', { answers: { BD_CANCER_HISTORY: 'true' } }, fx.customerId, fx.conversationId, 'agent')
  expect(agentModify.outcome).toBe('requires_confirmation')
  // nothing written — the confirmation contract
  const active = await prisma.answer.findFirst({ where: { applicationId: fx.applicationId, status: 'ACTIVE', question: { code: 'BD_CANCER_HISTORY' } } })
  expect(active?.value).toBe('false')

  const guiModify = await commit('write_medical_batch', { answers: { BD_CANCER_HISTORY: 'true' } }, fx.customerId, fx.conversationId, 'gui')
  expect(guiModify.outcome).toBe('applied')
  const postApp = await prisma.application.findUniqueOrThrow({ where: { id: fx.applicationId } })
  expect(postApp.includesAddon).toBe(false) // the 'true' fired the ELIGIBILITY edge
}, 120000)
