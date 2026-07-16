/**
 * T11 clause 5 (docs/plans/2026-07-15-design-questionnaire-ux-standard.md):
 * medical completion deterministically surfaces the review/sign card — the
 * write_question_answer commit that answers the LAST question carries
 * show_medical_review in its result whenever sensitive declarations are
 * pending signature. The live defect (2026-07-15, conv
 * cmrm3fgku00056g0y4eb2hsme msgs 54-56): after the 7th answer the completion
 * result said "sign_medical_declarations must confirm them (one card)" with
 * NO uiAction — the model narrated "pe cardul afișat" for a card that never
 * existed and the customer was stranded until typing the confirmation.
 */
import { it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, seedMinimalProtectFixture, signDntWithFacts } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { getNextQuestionInfo } from '@/lib/tools/handlers/application-handlers'
import { MEDICAL_COMPLETION_MESSAGE, APPLICATION_COMPLETION_MESSAGE } from '@/lib/tools/handlers/questionnaire-cards'
import type { ToolContext } from '@/lib/tools/types'

beforeEach(async () => { await resetDb() })

const ctx = (customerId: string, conversationId: string) =>
  ({ customerId, conversationId, language: 'ro', db: prisma, actor: 'gui' } as unknown as ToolContext)

interface MedicalReviewCard {
  type: string
  payload: {
    applicationId: string
    declarations: { code: string; question: { en: string; ro: string }; value: string; valueLabel: { en: string; ro: string } | null }[]
  }
}

const BD_CODES = ['BD_CANCER_HISTORY', 'BD_CARDIOVASCULAR', 'BD_NEUROLOGICAL', 'BD_TRANSPLANT', 'BD_CHRONIC_CONDITIONS', 'BD_HOSPITALIZATION_RECENT']

/** Answers every application question through the GATEWAY, returns the LAST envelope. */
async function answerAllViaGateway(customerId: string, conversationId: string) {
  let last: Awaited<ReturnType<typeof executeCommit>> | null = null
  for (let i = 0; i < 50; i++) {
    const n = await getNextQuestionInfo({}, ctx(customerId, conversationId))
    if (!n.success) throw new Error(`get_next_question failed: ${n.error}`)
    const d = n.data as { isComplete?: boolean; question?: { code: string | null } }
    if (d.isComplete || !d.question?.code) break
    // HEALTH 'da' (a 'nu' escalates to PAUSED); BD_* 'nu' (clean declarations)
    const answer = d.question.code.startsWith('BD_') ? 'nu' : 'da'
    last = await executeCommit({ tool: 'write_question_answer', args: { answer, questionCode: d.question.code }, actor: 'gui', customerId, conversationId, toolContext: ctx(customerId, conversationId) })
    if (last.outcome !== 'applied') throw new Error(`write_question_answer(${d.question.code}) failed: ${JSON.stringify(last)}`)
  }
  if (!last) throw new Error('no questions were answered — is the application group seeded?')
  return last
}

it('the commit that answers the LAST question carries show_medical_review (all pending declarations) and the T11 completion _message', async () => {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'simple_protection' })

  const last = await answerAllViaGateway(fx.customerId, fx.conversationId)
  const data = last.data as { isComplete: boolean; readyForQuote: boolean; _uiAction?: MedicalReviewCard; _message?: string }
  expect(data.isComplete).toBe(true)
  expect(data.readyForQuote).toBe(true)
  expect(data._message).toBe(MEDICAL_COMPLETION_MESSAGE)

  const card = data._uiAction
  expect(card?.type).toBe('show_medical_review')
  expect(card?.payload.applicationId).toBe(fx.applicationId)
  // exactly the CONFIRM_ALWAYS set — HEALTH_DECLARATION_CONFIRM (ON_MODIFY) is not a declaration
  expect(card?.payload.declarations.map((d) => d.code).sort()).toEqual([...BD_CODES].sort())
  for (const d of card!.payload.declarations) {
    expect(d.question).toHaveProperty('ro')
    expect(d.question).toHaveProperty('en')
    expect(d.value).toBe('false')
    expect(d.valueLabel).toEqual({ en: 'No', ro: 'Nu' })
  }
})

it('no-medical completion (addon off) keeps the plain completion message — no card, no sign_medical sentence', async () => {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'simple_protection' })

  const last = await answerAllViaGateway(fx.customerId, fx.conversationId)
  const data = last.data as { isComplete: boolean; _uiAction?: MedicalReviewCard; _message?: string }
  expect(data.isComplete).toBe(true)
  expect(data._message).toBe(APPLICATION_COMPLETION_MESSAGE)
  expect(data._message).not.toContain('sign_medical_declarations')
  expect(data._uiAction).toBeUndefined()
})

it('the card posts a tokenless gui sign_medical_declarations that applies in ONE call (single-confirmation ruling)', async () => {
  const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: true })
  await signDntWithFacts(fx, { DNT_LIFE_SUBTYPE: 'simple_protection' })
  await answerAllViaGateway(fx.customerId, fx.conversationId)

  const signed = await executeCommit({ tool: 'sign_medical_declarations', args: {}, actor: 'gui', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: ctx(fx.customerId, fx.conversationId) })
  expect(signed.outcome).toBe('applied')
  expect(await prisma.medicalDeclarationSignature.count({ where: { applicationId: fx.applicationId } })).toBe(1)
})
