/**
 * Questionnaire cards — the ONE builder for both questionnaire families
 * (T9/T12, docs/plans/2026-07-15-design-questionnaire-ux-standard.md).
 *
 * The UX standard holds BY CONSTRUCTION: dnt-handlers, application-handlers,
 * select-coverage-handlers and the reload re-derive (lib/chat/
 * derive-pending-card.ts) all build their `show_question` cards and their
 * conduct-bearing `_message`s here, so the two families can never drift
 * apart in shape or wording. A future questionnaire that uses this module
 * gets the standard for free; one that bypasses it fails the parity ratchet
 * (ui-action-registry + diagnostics).
 */

import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { computeVisibleSet } from '@/lib/engines/dependency-graph'
import { loadDependencyGraph } from '@/lib/engines/dependency-graph-loader'
import { getActiveAnswers } from '@/lib/engines/answer-store'
import { loadMedicalDeclarationState } from '@/lib/engines/medical-declaration-state'
import type { DbClient } from '@/lib/tools/types'

export type QuestionnaireGroupType = 'dnt' | 'application'

/**
 * The minimal question shape a card needs — satisfied by both raw Prisma
 * Question rows (dnt-handlers' sessionNextQuestion) and the engine's
 * QuestionData (getNextQuestion). Localized objects ride the payload
 * untouched; the CARD localizes, never the server.
 */
export interface CardQuestion {
  id: string
  code: string | null
  text: unknown
  helpText?: unknown
  type: string
  options: unknown
  validationRules: unknown
}

export interface CardProgress {
  answered: number
  total: number
}

export interface QuestionCardAction {
  type: 'show_question'
  payload: Record<string, unknown>
}

/**
 * Clause 2 (canonical wording): the conduct instruction is SERVER-owned —
 * embedded in every questionnaire tool `_message`, never left to the prompt.
 * The card renders the question and options; the model contributes at most
 * one short invite line.
 */
export const CONDUCT_LINE =
  'A question card is shown to the customer with all the options — NEVER list the options in prose (no "Opțiuni:" lists) and never repeat the question text; invite the customer to answer on the card in ONE short line.'

/**
 * Clause 1/3: the `show_question` card for the next pending question —
 * unified shape for BOTH families (the payload question carries
 * validationRules for both; historically only DNT did). Returns undefined
 * when there is no next question (completion paths emit review cards — T7/
 * T11 — never a question card).
 */
export function questionCard(
  groupType: QuestionnaireGroupType,
  next: CardQuestion | null | undefined,
  progress: CardProgress,
): QuestionCardAction | undefined {
  if (!next) return undefined
  return {
    type: 'show_question',
    payload: {
      question: {
        id: next.id,
        code: next.code,
        text: next.text as { en: string; ro: string },
        helpText: (next.helpText ?? null) as { en: string; ro: string } | null,
        type: next.type,
        options: next.options,
        validationRules: next.validationRules,
      },
      // normalized: calculateProgress adds a percentage field the card
      // contract does not carry — the payload is exactly {answered, total}
      progress: { answered: progress.answered, total: progress.total },
      groupType,
    },
  }
}

/**
 * Clause 5/6 (T7): the DNT completion `_message`. The review card is emitted
 * in the SAME result, so the model must never re-open the confirmation in
 * prose or sign on the customer's behalf — the ONLY confirmation is the
 * customer's Sign click on the card (single-confirmation ruling). Live
 * evidence for every clause of this wording: conv cmrm3fgku00056g0y4eb2hsme
 * msgs 32-38, where one signature cost four customer interactions.
 */
export const DNT_COMPLETION_MESSAGE =
  'All DNT questions answered. A review card with consent checkboxes and a Sign button is shown — do NOT ask for confirmation in prose and do NOT call sign_dnt yourself; invite the customer to review and sign on the card in ONE short line.'

/**
 * Clause 5/7 (T11): the application completion `_message`s. When sensitive
 * declarations are pending signature the review card rides the SAME result,
 * so the message says the card is already shown and forbids BOTH the
 * self-sign and referencing cards no tool emitted. Live evidence (conv
 * cmrm3fgku00056g0y4eb2hsme msgs 54-56): the old message said a card "must
 * confirm" the declarations while emitting nothing — the model narrated
 * "pe cardul afișat" for a card that never existed and the customer was
 * stranded until typing the confirmation.
 */
export const MEDICAL_COMPLETION_MESSAGE =
  'Application questionnaire complete. A medical-declarations review card with a Sign button is shown to the customer — do NOT call sign_medical_declarations yourself and do NOT reference any card unless a tool result THIS turn emitted one; invite them to sign in ONE short line.'

/** T11: the no-pending-medical completion — the old conditional sign_medical
 * sentence is gone (the card decision is the handler's, never the model's). */
export const APPLICATION_COMPLETION_MESSAGE =
  'Application questionnaire complete. Generate the quote.'

/**
 * Clause 2: the save-path `_message`. Has-next embeds CONDUCT_LINE (DNT
 * keeps its Next-question-code prefix and typed-fallback hint — B2.7 live
 * lesson: agents guess codes without it); DNT completion is the T7 review-
 * card message; the application completion is the NO-pending-medical
 * variant — the T11 handler swaps in MEDICAL_COMPLETION_MESSAGE (and the
 * card) when the declaration state says a signature is pending.
 */
export function savedMessage(
  groupType: QuestionnaireGroupType,
  next: { code: string | null } | null | undefined,
  progress: CardProgress,
): string {
  if (!next) {
    return groupType === 'dnt'
      ? DNT_COMPLETION_MESSAGE
      : APPLICATION_COMPLETION_MESSAGE
  }
  const remaining = progress.total - progress.answered
  return groupType === 'dnt'
    ? `Answer saved. Next question code: ${next.code}. ${remaining} remaining. ${CONDUCT_LINE} If the customer types instead, call write_dnt_answer with questionCode "${next.code}".`
    : `Answer saved. ${remaining} questions remaining. ${CONDUCT_LINE}`
}

/**
 * Clause 3 rejection threading: a validation/grounding/code-mismatch REJECT
 * must re-emit the SAME question card so the customer is never stranded
 * card-less. The gateway rolls the apply tx back on {success:false} and the
 * rejection envelope spreads handler `data` (gateway.ts) — the executor
 * lifts `_uiAction` on ANY outcome (executor.ts), so threading the card
 * through `data._uiAction` is the one path that survives the rollback.
 */
export function rejectReemit<T extends Record<string, unknown>>(
  data: T | undefined,
  card: QuestionCardAction | MedicalBatchCardAction | undefined,
): Record<string, unknown> {
  return { ...(data ?? {}), ...(card ? { _uiAction: card } : {}) }
}

export interface DntReviewAnswer {
  code: string | null
  /** Localized question text — the CARD localizes, never the server. */
  question: { en: string; ro: string }
  value: string
  /** Resolved from the option list (or Yes/No for booleans); null for free text. */
  valueLabel: { en: string; ro: string } | null
}

export interface DntReviewCardAction {
  type: 'show_dnt_review'
  payload: {
    sessionId: string
    answers: DntReviewAnswer[]
    progress: CardProgress
  }
}

const BOOLEAN_LABELS: Record<string, { en: string; ro: string }> = {
  true: { en: 'Yes', ro: 'Da' },
  false: { en: 'No', ro: 'Nu' },
}

function resolveValueLabel(options: unknown, value: string): { en: string; ro: string } | null {
  if (Array.isArray(options)) {
    const match = options.find((o) => o && typeof o === 'object' && (o as { value?: unknown }).value === value)
    const label = (match as { label?: unknown } | undefined)?.label
    if (label && typeof label === 'object' && 'en' in (label as object) && 'ro' in (label as object)) {
      return label as { en: string; ro: string }
    }
  }
  // BOOLEAN answers normalize to 'true'/'false' (questionnaire-engine) —
  // a raw 'true' on a customer-facing recap is not legible.
  return BOOLEAN_LABELS[value] ?? null
}

/**
 * Clause 5 (T7): the review/sign card the COMPLETING commit carries — all of
 * the session's product-scoped visible answers in question order, plus the
 * two unchecked consent checkboxes and the Sign button (rendered client-side).
 * Callers inside a gateway transaction MUST pass context.db so the walk sees
 * the just-written answer. The CNP is shown exactly as STORED — the DntAnswer
 * row holds the MASK (P0-3), never the raw identifier.
 */
export async function buildDntReviewCard(sessionId: string, db: DbClient): Promise<DntReviewCardAction> {
  const session = await db.dntSession.findUniqueOrThrow({ where: { id: sessionId }, select: { productId: true } })
  // scope to the SESSION's product, never the conversation's (a resumed
  // conversation may point elsewhere; the session is the regulatory record)
  const codes = await resolveGroupCodes(session.productId, 'dnt', db)
  const groups = await db.questionGroup.findMany({ where: { code: { in: codes } }, orderBy: { orderIndex: 'asc' } })
  const questions = await db.question.findMany({ where: { groupId: { in: groups.map((g) => g.id) } } })
  const groupOrder = new Map(groups.map((g) => [g.id, g.orderIndex]))
  questions.sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.orderIndex - b.orderIndex)
  const answerRows = await db.dntAnswer.findMany({ where: { sessionId }, select: { questionId: true, value: true } })
  const answersById = new Map(answerRows.map((a) => [a.questionId, a.value]))

  // visibility recompute — same store the handlers' session walk uses (C1.8)
  const answersByCode: Record<string, string> = {}
  const codeList: string[] = []
  for (const q of questions) {
    if (!q.code) continue
    codeList.push(q.code)
    const v = answersById.get(q.id)
    if (v !== undefined) answersByCode[q.code] = v
  }
  const graph = await loadDependencyGraph(db)
  const visibleSet = computeVisibleSet(graph, codeList, { answers: answersByCode, selection: { tier: null, level: null, addon: null } })

  const answers: DntReviewAnswer[] = []
  let total = 0
  for (const q of questions) {
    if (q.code && !visibleSet.has(q.code)) continue
    total++
    const value = answersById.get(q.id)
    if (value === undefined) continue
    answers.push({
      code: q.code,
      question: q.text as { en: string; ro: string },
      value,
      valueLabel: resolveValueLabel(q.options, value),
    })
  }
  return {
    type: 'show_dnt_review',
    payload: { sessionId, answers, progress: { answered: answers.length, total } },
  }
}

export interface MedicalBatchCondition {
  code: string
  /** Localized question text — the CARD localizes, never the server. */
  question: { en: string; ro: string }
  /** The ACTIVE answer where one exists (a revisit renders pre-toggled); null = unanswered (the card defaults the toggle to Nu). */
  value: 'true' | 'false' | null
}

export interface MedicalBatchCardAction {
  type: 'show_medical_batch'
  payload: {
    applicationId: string
    conditions: MedicalBatchCondition[]
    progress: CardProgress
  }
}

/** T10: the pure payload shape — the async loader below feeds it. */
export function buildMedicalBatchCard(
  applicationId: string,
  conditions: MedicalBatchCondition[],
  progress: CardProgress,
): MedicalBatchCardAction {
  return {
    type: 'show_medical_batch',
    payload: {
      applicationId,
      conditions,
      // normalized like questionCard: exactly {answered, total}
      progress: { answered: progress.answered, total: progress.total },
    },
  }
}

/**
 * T10 (ruling: option c): the ONE medical card — every VISIBLE BD_* question
 * in the engine's walk order (group orderIndex, question orderIndex) with the
 * current ACTIVE value where answered (a revisit renders pre-toggled) and
 * null otherwise. Emitted INSTEAD of the single-question card whenever the
 * questionnaire's next question is a BD_* code (write_question_answer save
 * path, select_coverage completing commit, resume_application, the batch
 * handler itself, and the reload re-derive). Callers inside a gateway
 * transaction MUST pass context.db so the walk sees the just-applied writes.
 */
export async function medicalBatchCard(
  db: DbClient,
  applicationId: string,
  progress: CardProgress,
): Promise<MedicalBatchCardAction> {
  const application = await db.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: { productId: true, includesAddon: true, tierId: true, levelId: true },
  })
  const groupCodes = (await resolveGroupCodes(application.productId, 'application', db)) ?? []
  const groups = await db.questionGroup.findMany({ where: { code: { in: groupCodes } }, orderBy: { orderIndex: 'asc' } })
  const questions = await db.question.findMany({ where: { groupId: { in: groups.map((g) => g.id) } } })
  const groupOrder = new Map(groups.map((g) => [g.id, g.orderIndex]))
  questions.sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.orderIndex - b.orderIndex)

  // sequential on purpose: db may be the gateway's single-connection tx client
  const tier = application.tierId ? await db.pricingTier.findUnique({ where: { id: application.tierId }, select: { code: true } }) : null
  const level = application.levelId ? await db.pricingLevel.findUnique({ where: { id: application.levelId }, select: { code: true } }) : null
  const active = await getActiveAnswers(db, applicationId)
  const graph = await loadDependencyGraph(db, application.productId)
  const visible = computeVisibleSet(
    graph,
    questions.map((q) => q.code).filter((c): c is string => c !== null),
    { answers: active, selection: { tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon } },
  )

  const conditions: MedicalBatchCondition[] = questions
    .filter((q): q is typeof q & { code: string } => q.code !== null && q.code.startsWith('BD_') && visible.has(q.code))
    .map((q) => ({
      code: q.code,
      question: q.text as { en: string; ro: string },
      value: active[q.code] === 'true' ? 'true' : active[q.code] === 'false' ? 'false' : null,
    }))
  return buildMedicalBatchCard(applicationId, conditions, progress)
}

/**
 * Clause 5 (T11): the application questionnaire's SHARED completion result —
 * when sensitive declarations are pending signature the medical review/sign
 * card rides the completing commit; otherwise the plain completion message.
 * Used by BOTH write_question_answer and write_medical_batch so the two
 * write paths cannot drift. Callers inside the gateway tx pass context.db.
 */
export async function applicationCompletion(
  db: DbClient,
  application: { id: string; productId: string; includesAddon: boolean; tierId: string | null; levelId: string | null },
): Promise<{ message: string; uiAction?: MedicalReviewCardAction }> {
  const medical = await loadMedicalDeclarationState(db, application)
  const pendingSignature = medical.requiredCodes.length > 0 && !medical.signed
  return pendingSignature
    ? { message: MEDICAL_COMPLETION_MESSAGE, uiAction: buildMedicalReviewCard(application.id, medical) }
    : { message: savedMessage('application', null, { answered: 0, total: 0 }) }
}

export interface MedicalReviewDeclaration {
  code: string
  /** Localized question text — the CARD localizes, never the server. */
  question: { en: string; ro: string }
  value: string
  /** Da/Nu for the BOOLEAN declarations; null for anything else (card falls back to the raw value). */
  valueLabel: { en: string; ro: string } | null
}

export interface MedicalReviewCardAction {
  type: 'show_medical_review'
  payload: {
    applicationId: string
    declarations: MedicalReviewDeclaration[]
  }
}

/**
 * Clause 5 (T11): the review/sign card the COMPLETING write_question_answer
 * carries when `loadMedicalDeclarationState` says sensitive declarations are
 * pending signature. The loader is the ONE place that decides WHICH answers
 * the customer signs (medical-declaration-state.ts) and it already carries
 * the localized question text per declaration — this builder only shapes it
 * for the card. NO checkboxes ride the payload: the consents were captured
 * at DNT, the Sign click is the single affirmation (clause 6).
 */
export function buildMedicalReviewCard(
  applicationId: string,
  state: { declarations: { code: string; text: { en: string; ro: string }; value: string }[] },
): MedicalReviewCardAction {
  return {
    type: 'show_medical_review',
    payload: {
      applicationId,
      declarations: state.declarations.map((d) => ({
        code: d.code,
        question: d.text,
        value: d.value,
        // the BD declarations are BOOLEAN — options never ride the loader
        // state, so the boolean fallback is the whole label story here
        valueLabel: resolveValueLabel(undefined, d.value),
      })),
    },
  }
}
