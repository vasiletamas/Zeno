/**
 * Application Handlers (B4) — the customer-scoped application lifecycle.
 *
 * set_application freezes PRODUCT only (T5.D3) and carries no DNT pre-gate
 * (T5.D1 — the DNT ordering flip lives in questionnaire exposure);
 * answers key on the APPLICATION (B4.1 re-key); selection is
 * select_coverage's business (T5.D2 — single writer, no selection
 * questions); cancel is a confirmed terminal CANCELLED (never COMPLETED);
 * resume works cross-conversation via Conversation.activeApplicationId
 * (T5.D4) and get_last_application_info surfaces prior answers as
 * PROPOSALS the customer confirms one by one (T5.D5).
 */

import {
  getNextQuestion,
  validateAnswer,
  checkForFlags,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { canTransition, type AppStatus } from '@/lib/engines/application-rules'
import { writeRevision } from '@/lib/engines/answer-store'
import { getIdentityFacts } from '@/lib/customer/profile-service'
import { deriveIdentityTier } from '@/lib/engines/identity-rules'
import type { ToolHandler, ToolContext } from '@/lib/tools/types'
import { bumpInsightOnAnswer } from './insight-bump'

/**
 * The active question-group codes for an application. The BD medical
 * questionnaire belongs to the set only while the addon is selected (#4 —
 * select_coverage's cascade_expand/questions_removed toggle it; answers
 * are retained but excluded when the addon is off).
 */
export async function appGroupCodesFor(context: { conversationId: string; product?: { id: string } }, includesAddon: boolean): Promise<string[]> {
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  const codes = (await resolveGroupCodes(productId, 'application')) ?? []
  // bd_medical is seeded phase 'application', so it arrives IN codes — the
  // addon toggle EXCLUDES it when off (answers retained, just excluded, #4).
  return includesAddon ? codes : codes.filter((c) => c !== 'bd_medical')
}

/** The conversation's active application (T5.D4 channel pointer). */
export async function loadActiveApplication(context: ToolContext) {
  const conv = await context.db.conversation.findUnique({
    where: { id: context.conversationId },
    select: { activeApplicationId: true },
  })
  if (!conv?.activeApplicationId) return null
  return context.db.application.findUnique({ where: { id: conv.activeApplicationId } })
}

// ─────────────────────────────────────────────
// set_application (B4.3) — freeze product only
// ─────────────────────────────────────────────

export const setApplication: ToolHandler = async (args, context) => {
  try {
    const conv = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
      select: { productId: true, candidateProductId: true },
    })
    const productId: string | null =
      (args.productId as string | undefined) ?? context.product?.id ?? conv?.productId ?? conv?.candidateProductId ?? null
    if (!productId) {
      return { success: false, error: 'no_candidate_product: choose the product first (set_candidate_product).' }
    }

    // customer-scoped uniqueness: one live application per (customer, product)
    const existing = await context.db.application.findFirst({
      where: { customerId: context.customerId, productId, status: { in: ['OPEN', 'PAUSED', 'REFERRED'] } },
    })
    if (existing) {
      return { success: false, error: `application_already_open: ${existing.id} (status ${existing.status}) — resume it instead.` }
    }

    const application = await context.db.application.create({
      data: {
        customerId: context.customerId,
        productId, // frozen (T5.D3): coverage moves via select_coverage, product changes need a new application
        originConversationId: context.conversationId,
        status: 'OPEN',
      },
    })
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: { activeApplicationId: application.id, productId },
    })

    // R6 soft offer (ADD-3): a flag for the copy layer, never a wall.
    const facts = await getIdentityFacts(context.customerId, context.db)
    const softOffer = deriveIdentityTier(facts) !== 'verified_channel'

    return {
      success: true,
      data: {
        applicationId: application.id,
        productFrozen: productId,
        ...(softOffer ? { softOffer: 'channel_verification' } : {}),
      },
      message: 'Application opened for the product in focus. The needs analysis (DNT) gates the questionnaire, and coverage is chosen with select_coverage.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// save_application_answer (B4.1 re-key)
// ─────────────────────────────────────────────

export const saveApplicationAnswer: ToolHandler = async (args, context) => {
  const answer = args.answer as string

  try {
    const application = await loadActiveApplication(context)
    if (!application || application.status !== 'OPEN') {
      return { success: false, error: 'No open application found. Please set an application first.' }
    }

    const activeGroupCodes = await appGroupCodesFor(context, application.includesAddon)
    const scope = { kind: 'application' as const, applicationId: application.id }

    const currentResult = await getNextQuestion(activeGroupCodes, scope)
    if (!currentResult) {
      return {
        success: true,
        data: { alreadyComplete: true, applicationId: application.id, readyForQuote: true },
        message: 'All application questions have already been answered.',
      }
    }

    const currentQuestion = currentResult.question

    const questionMeta = await context.db.question.findUnique({
      where: { id: currentQuestion.id },
      include: { group: true },
    })
    const priorInsight = questionMeta?.insightKey
      ? await context.db.customerInsight.findUnique({
          where: { customerId_key: { customerId: context.customerId, key: questionMeta.insightKey } },
        })
      : null

    const validation = validateAnswer(
      { type: currentQuestion.type, options: currentQuestion.options, validationRules: currentQuestion.validationRules },
      answer,
    )
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid answer.' }
    }

    const flagResult = checkForFlags(currentQuestion.validationRules, validation.normalizedValue)

    const saveAnswer = () =>
      writeRevision(context.db, {
        applicationId: application.id,
        questionId: currentQuestion.id,
        value: validation.normalizedValue,
        source: 'USER_ANSWER',
      })

    // escalate-class flag: save, pause, surface
    if (flagResult.flagged && flagResult.action === 'escalate') {
      await saveAnswer()
      const existingFlags = (application.flagsForReview as unknown as Array<Record<string, unknown>>) ?? []
      const newFlag = { questionCode: currentQuestion.code, answer: validation.normalizedValue, reason: flagResult.reason, action: flagResult.action }
      await context.db.application.update({
        where: { id: application.id },
        data: { status: 'PAUSED', flagsForReview: JSON.parse(JSON.stringify([...existingFlags, newFlag])) },
      })
      return {
        success: true,
        data: { answerSaved: true, escalated: true, reason: flagResult.reason, applicationId: application.id },
        message: `Application paused for review. ${flagResult.reason ?? 'This answer requires human review.'}`,
      }
    }

    if (flagResult.flagged && flagResult.action === 'flag') {
      const existingFlags = (application.flagsForReview as unknown as Array<Record<string, unknown>>) ?? []
      const newFlag = { questionCode: currentQuestion.code, answer: validation.normalizedValue, reason: flagResult.reason, action: 'flag' }
      await context.db.application.update({
        where: { id: application.id },
        data: { flagsForReview: JSON.parse(JSON.stringify([...existingFlags, newFlag])) },
      })
    }

    await saveAnswer()
    await context.db.application.update({
      where: { id: application.id },
      data: { currentQuestionIndex: application.currentQuestionIndex + 1 },
    })

    if (questionMeta?.insightKey) {
      await bumpInsightOnAnswer({
        customerId: context.customerId,
        conversationId: context.conversationId,
        question: { id: questionMeta.id, code: questionMeta.code, insightKey: questionMeta.insightKey, group: { code: questionMeta.group.code } },
        answerValue: validation.normalizedValue,
        previousInsightValue: priorInsight?.value,
        previousInsightCategory: priorInsight?.category,
      })
    }

    const nextResult = await getNextQuestion(activeGroupCodes, scope)
    if (!nextResult) {
      // Completeness is DERIVED (missingCodes = []) — the status machine
      // stays OPEN; generate_quote exposure turns on from the derived state.
      return {
        success: true,
        data: { answerSaved: true, isComplete: true, applicationId: application.id, readyForQuote: true },
        message: 'Application questionnaire complete. Choose coverage with select_coverage if not chosen, then generate the quote.',
      }
    }

    const lang = context.language ?? 'ro'
    const nq = nextResult.question
    const nqText = nq.text as { en: string; ro: string }
    return {
      success: true,
      data: {
        answerSaved: true,
        isComplete: false,
        nextQuestion: {
          id: nq.id,
          code: nq.code,
          text: nqText[lang],
          helpText: nq.helpText ? (nq.helpText as { en: string; ro: string })[lang] : null,
          type: nq.type,
          options: nq.options,
        },
        progress: nextResult.progress,
      },
      message: `Answer saved. ${nextResult.progress.total - nextResult.progress.answered} questions remaining.`,
      uiAction: {
        type: 'show_question',
        payload: {
          question: { id: nq.id, code: nq.code, text: nq.text as { en: string; ro: string }, helpText: nq.helpText as { en: string; ro: string } | null, type: nq.type, options: nq.options },
          progress: nextResult.progress,
          groupType: 'application',
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// get_application_status was retired by A3.ADD-1 (T13.D8): the compact
// DerivedStateV3 summary is injected every turn and get_current_state is the
// single on-demand detail read.

// ─────────────────────────────────────────────
// resume_application (B4.6) — cross-conversation
// ─────────────────────────────────────────────

/**
 * Deliberate deviation from the catalog R-classification (recorded per
 * erratum 6): binding the conversation pointer and unpausing ARE state
 * changes, so resume_application is a commit whose data payload carries the
 * position read — the pure-read half of T5.D4 lives in `position`.
 */
export const resumeApplication: ToolHandler = async (args, context) => {
  try {
    const requestedId = args.applicationId as string | undefined
    const application = requestedId
      ? await context.db.application.findUnique({ where: { id: requestedId } })
      : await context.db.application.findFirst({
          where: { customerId: context.customerId, status: { in: ['OPEN', 'PAUSED', 'REFERRED'] } },
          orderBy: { updatedAt: 'desc' },
        })
    if (!application || application.customerId !== context.customerId) {
      return { success: false, error: 'No resumable application found for this customer.' }
    }
    if (application.status === 'REFERRED') {
      return { success: false, error: 'with_underwriter: the application is under review — it resumes when the underwriter answers.' }
    }
    if (application.status !== 'OPEN' && application.status !== 'PAUSED') {
      return { success: false, error: `illegal_status_transition: a ${application.status} application cannot be resumed.` }
    }

    if (application.status === 'PAUSED') {
      await context.db.application.update({ where: { id: application.id }, data: { status: 'OPEN' } })
    }
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: { activeApplicationId: application.id, productId: application.productId },
    })

    const codes = await appGroupCodesFor(context, application.includesAddon)
    const scope = { kind: 'application' as const, applicationId: application.id }
    const [next, progress, tier, level] = await Promise.all([
      getNextQuestion(codes, scope),
      calculateProgress(codes, scope),
      application.tierId ? context.db.pricingTier.findUnique({ where: { id: application.tierId } }) : null,
      application.levelId ? context.db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null,
    ])

    const lang = context.language ?? 'ro'
    return {
      success: true,
      data: {
        position: {
          applicationId: application.id,
          status: 'OPEN',
          progress,
          nextQuestion: next
            ? { id: next.question.id, code: next.question.code, text: (next.question.text as { en: string; ro: string })[lang], type: next.question.type, options: next.question.options }
            : null,
          selection: { tier: tier?.code ?? null, level: level?.code ?? null, addon: application.includesAddon },
        },
      },
      message: next
        ? 'Application resumed — continuing where the customer left off.'
        : 'Application resumed. All questions already answered — ready for coverage selection / quote.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// cancel_application (B4.5) — confirmed, terminal
// ─────────────────────────────────────────────

export const cancelApplication: ToolHandler = async (args, context) => {
  const reason = (args.reason as string | undefined) ?? 'cancelled'

  try {
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'No active application found to cancel.' }
    }
    if (!canTransition(application.status as AppStatus, 'CANCELLED')) {
      return { success: false, error: `illegal_status_transition: a ${application.status} application cannot be cancelled.` }
    }

    const flags = (application.flagsForReview as unknown as Array<Record<string, unknown>>) ?? []
    await context.db.application.update({
      where: { id: application.id },
      data: {
        status: 'CANCELLED', // T5.D6: cancel is distinguishable from completion
        completedAt: null,
        flagsForReview: JSON.parse(JSON.stringify([...flags, { cancelReason: reason }])),
      },
    })
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: { activeApplicationId: null },
    })

    return {
      success: true,
      data: { applicationId: application.id, status: 'CANCELLED', reason },
      effects: ['terminal'],
      message: 'Application cancelled.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// get_last_application_info (B4.6) — prefill-as-proposals, pure read
// ─────────────────────────────────────────────

export const getLastApplicationInfo: ToolHandler = async (_args, context) => {
  try {
    const conv = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
      select: { productId: true, candidateProductId: true },
    }).catch(() => null)
    const focusProductId = context.product?.id ?? conv?.productId ?? conv?.candidateProductId ?? undefined

    const prior = await context.db.application.findFirst({
      where: { customerId: context.customerId, status: 'COMPLETED', ...(focusProductId ? { productId: focusProductId } : {}) },
      orderBy: { completedAt: 'desc' },
    })
    if (!prior) {
      return { success: true, data: { proposals: [] }, message: 'No completed prior application — nothing to propose.' }
    }

    const answers = await context.db.answer.findMany({
      where: { applicationId: prior.id, status: 'ACTIVE' },
      include: { question: { select: { code: true } } },
      orderBy: { answeredAt: 'asc' },
    })
    // PROPOSALS, not answers (T5.D5): each needs the customer's per-question
    // confirmation via a real save_application_answer commit stamped now.
    const proposals = answers
      .filter((a) => a.question.code)
      .map((a) => ({ questionCode: a.question.code as string, suggestedAnswer: a.value, answeredAt: a.answeredAt.toISOString() }))

    return {
      success: true,
      data: { applicationId: prior.id, completedAt: prior.completedAt?.toISOString() ?? null, proposals },
      message: `Found ${proposals.length} prior answers as proposals — confirm each with the customer before saving; never copy silently.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
