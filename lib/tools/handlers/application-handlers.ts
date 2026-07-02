/**
 * Application Handlers
 *
 * start_application, save_application_answer, get_application_status,
 * resume_application, cancel_application
 */

import {
  getNextQuestion,
  validateAnswer,
  checkForFlags,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { hasValidDnt } from '@/lib/customer/dnt-lookup'
import type { ToolHandler } from '@/lib/tools/types'
import { trackProductSelected } from '@/lib/analytics/events'
import { bumpInsightOnAnswer } from './insight-bump'

async function appGroupCodes(context: { conversationId: string; product?: { id: string } }) {
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  return resolveGroupCodes(productId, 'application')
}

// ─────────────────────────────────────────────
// start_application
// ─────────────────────────────────────────────

export const startApplication: ToolHandler = async (args, context) => {
  try {
    const tierCode = args.tierCode as string | undefined
    const levelCode = args.levelCode as string | undefined
    const includesAddon = args.includesAddon as boolean | undefined

    const conv = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
      select: { productId: true, candidateProductId: true },
    })
    // DNT gate (B2.6): the customer-scoped Dnt aggregate is the only truth.
    const dntValid = await hasValidDnt(context.customerId, 'LIFE', context.db)
    if (!dntValid) return { success: false, error: 'DNT must be signed before starting an application.' }

    const existing = await context.db.application.findUnique({ where: { conversationId: context.conversationId } })
    if (existing && existing.status === 'OPEN') {
      return { success: true, data: { alreadyExists: true, applicationId: existing.id }, message: 'An open application already exists for this conversation.' }
    }

    const productId: string | null = context.product?.id ?? conv?.productId ?? conv?.candidateProductId ?? null
    if (!productId) return { success: false, error: 'No product selected. Call set_candidate_product first or pass an explicit productId.' }

    let tierId: string | null = null
    if (tierCode) {
      const tier = await context.db.pricingTier.findFirst({ where: { productId, code: tierCode } })
      if (!tier) return { success: false, error: `Pricing tier "${tierCode}" not found for this product. Provide a valid tier code.` }
      tierId = tier.id
    }

    let levelId: string | null = null
    if (levelCode) {
      if (!tierId) return { success: false, error: 'levelCode requires tierCode to be provided first.' }
      const level = await context.db.pricingLevel.findFirst({ where: { tierId, code: levelCode } })
      if (!level) return { success: false, error: `Pricing level "${levelCode}" not found for the selected tier. Provide a valid level code.` }
      levelId = level.id
    }

    const codes = await resolveGroupCodes(productId, 'application')
    const progress = await calculateProgress(codes, { kind: 'conversation', conversationId: context.conversationId })

    const application = await context.db.application.create({
      data: {
        conversationId: context.conversationId,
        customerId: context.customerId,
        productId,
        tierId,
        levelId,
        includesAddon: includesAddon ?? false,
        status: 'OPEN',
        currentQuestionIndex: 0,
        totalQuestions: progress.total,
      },
    })

    // Record the conversational selections as Answers so getNextQuestion skips them.
    const recordSelection = async (questionCode: string, value: string) => {
      const q = await context.db.question.findFirst({ where: { code: questionCode, group: { code: { in: codes } } } })
      if (!q) return
      await context.db.answer.upsert({
        where: { questionId_conversationId: { questionId: q.id, conversationId: context.conversationId } },
        create: { questionId: q.id, conversationId: context.conversationId, value },
        update: { value, answeredAt: new Date() },
      })
    }
    if (tierCode) await recordSelection('PACKAGE_CHOICE', tierCode)
    if (levelCode) await recordSelection('PREMIUM_LEVEL', levelCode)
    // !== undefined (not truthiness): includesAddon === false is a meaningful answer that must be recorded
    if (includesAddon !== undefined) await recordSelection('BD_ADDON_INTEREST', String(includesAddon))

    if (context.product?.id !== productId) {
      await context.db.conversation.update({ where: { id: context.conversationId }, data: { productId } })
    }

    const result = await getNextQuestion(codes, { kind: 'conversation', conversationId: context.conversationId })
    if (!result) return { success: false, error: 'No application questions configured.' }

    const lang = context.language ?? 'ro'
    const q = result.question
    const text = q.text as { en: string; ro: string }
    return {
      success: true,
      data: {
        applicationStarted: true,
        applicationId: application.id,
        currentQuestion: { id: q.id, code: q.code, text: text[lang], helpText: q.helpText ? (q.helpText as { en: string; ro: string })[lang] : null, type: q.type, options: q.options },
        progress: result.progress,
      },
      message: 'Application started.',
      uiAction: { type: 'show_question', payload: { question: { id: q.id, code: q.code, text: q.text as { en: string; ro: string }, helpText: q.helpText as { en: string; ro: string } | null, type: q.type, options: q.options }, progress: result.progress, groupType: 'application' } as unknown as Record<string, unknown> },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// save_application_answer
// ─────────────────────────────────────────────

export const saveApplicationAnswer: ToolHandler = async (args, context) => {
  const answer = args.answer as string
  const fieldArg = args.field as string | undefined

  try {
    // Find the active application
    const application = await context.db.application.findUnique({
      where: { conversationId: context.conversationId },
    })
    if (!application || application.status !== 'OPEN') {
      return {
        success: false,
        error: 'No open application found. Please start an application first.',
      }
    }

    // Determine active group codes from product via resolver
    const activeGroupCodes = await appGroupCodes(context)
    const activeGroupType = 'application'

    // Get current question
    const currentResult = await getNextQuestion(activeGroupCodes, { kind: 'conversation', conversationId: context.conversationId })
    if (!currentResult) {
      return {
        success: true,
        data: { alreadyComplete: true, applicationId: application.id },
        message: 'All application questions have already been answered.',
      }
    }

    const currentQuestion = currentResult.question

    // Refetch question with group + insightKey (needed for insight bump)
    const questionMeta = await context.db.question.findUnique({
      where: { id: currentQuestion.id },
      include: { group: true },
    })

    // Capture pre-existing insight (if any) to detect confirmed/denied for bd_medical
    const priorInsight = questionMeta?.insightKey
      ? await context.db.customerInsight.findUnique({
          where: {
            customerId_key: { customerId: context.customerId, key: questionMeta.insightKey },
          },
        })
      : null

    // Validate
    const validation = validateAnswer(
      { type: currentQuestion.type, options: currentQuestion.options, validationRules: currentQuestion.validationRules },
      answer,
    )
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid answer.' }
    }

    // Check flags
    const flagResult = checkForFlags(currentQuestion.validationRules, validation.normalizedValue)

    // If escalate: pause application
    if (flagResult.flagged && flagResult.action === 'escalate') {
      // Save answer first
      await context.db.answer.upsert({
        where: {
          questionId_conversationId: {
            questionId: currentQuestion.id,
            conversationId: context.conversationId,
          },
        },
        create: {
          questionId: currentQuestion.id,
          conversationId: context.conversationId,
          value: validation.normalizedValue,
        },
        update: {
          value: validation.normalizedValue,
          answeredAt: new Date(),
        },
      })

      // Accumulate flag
      const existingFlags = (application.flagsForReview as unknown as Array<Record<string, unknown>>) ?? []
      const newFlag = {
        questionCode: currentQuestion.code,
        answer: validation.normalizedValue,
        reason: flagResult.reason,
        action: flagResult.action,
      }

      await context.db.application.update({
        where: { id: application.id },
        data: {
          status: 'PAUSED',
          flagsForReview: JSON.parse(JSON.stringify([...existingFlags, newFlag])),
        },
      })

      return {
        success: true,
        data: {
          answerSaved: true,
          escalated: true,
          reason: flagResult.reason,
          applicationId: application.id,
        },
        message: `Application paused for review. ${flagResult.reason ?? 'This answer requires human review.'}`,
      }
    }

    // Accumulate soft flags
    if (flagResult.flagged && flagResult.action === 'flag') {
      const existingFlags = (application.flagsForReview as unknown as Array<Record<string, unknown>>) ?? []
      const newFlag = {
        questionCode: currentQuestion.code,
        answer: validation.normalizedValue,
        reason: flagResult.reason,
        action: 'flag',
      }
      await context.db.application.update({
        where: { id: application.id },
        data: {
          flagsForReview: JSON.parse(JSON.stringify([...existingFlags, newFlag])),
        },
      })
    }

    // Save answer
    await context.db.answer.upsert({
      where: {
        questionId_conversationId: {
          questionId: currentQuestion.id,
          conversationId: context.conversationId,
        },
      },
      create: {
        questionId: currentQuestion.id,
        conversationId: context.conversationId,
        value: validation.normalizedValue,
      },
      update: {
        value: validation.normalizedValue,
        answeredAt: new Date(),
      },
    })

    // Special question handling by code
    // Use fieldArg if provided (from UI direct field set), otherwise check currentQuestion.code
    const effectiveCode = fieldArg ?? currentQuestion.code
    const updateData: Record<string, unknown> = {
      currentQuestionIndex: application.currentQuestionIndex + 1,
    }

    if (effectiveCode === 'PACKAGE_CHOICE') {
      // Resolve PricingTier by answer value (e.g., "standard" or "optim")
      const tier = await context.db.pricingTier.findFirst({
        where: { productId: application.productId, code: validation.normalizedValue },
      })
      if (tier) updateData.tierId = tier.id
      trackProductSelected(context.customerId, validation.normalizedValue, '')
    }

    if (effectiveCode === 'PREMIUM_LEVEL') {
      // Resolve PricingLevel by answer value (e.g., "level_1")
      if (application.tierId) {
        const level = await context.db.pricingLevel.findFirst({
          where: { tierId: application.tierId, code: validation.normalizedValue },
        })
        if (level) updateData.levelId = level.id
      }
      trackProductSelected(context.customerId, '', validation.normalizedValue)
    }

    if (effectiveCode === 'BD_ADDON_INTEREST') {
      updateData.includesAddon = validation.normalizedValue === 'true'
    }

    await context.db.application.update({
      where: { id: application.id },
      data: updateData,
    })

    // Bump insight + write compliance resolution log for bd_medical CONTEXT HITs
    if (questionMeta?.insightKey) {
      await bumpInsightOnAnswer({
        customerId: context.customerId,
        conversationId: context.conversationId,
        question: {
          id: questionMeta.id,
          code: questionMeta.code,
          insightKey: questionMeta.insightKey,
          group: { code: questionMeta.group.code },
        },
        answerValue: validation.normalizedValue,
        previousInsightValue: priorInsight?.value,
        previousInsightCategory: priorInsight?.category,
      })
    }

    // Get next question
    const nextResult = await getNextQuestion(activeGroupCodes, { kind: 'conversation', conversationId: context.conversationId })

    if (!nextResult) {
      // Mark application as COMPLETED
      await context.db.application.update({
        where: { id: application.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })

      return {
        success: true,
        data: {
          answerSaved: true,
          isComplete: true,
          applicationId: application.id,
          readyForQuote: true,
        },
        message: 'Application complete! All questions answered. Ready to generate a quote.',
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
          question: {
            id: nq.id,
            code: nq.code,
            text: nq.text as { en: string; ro: string },
            helpText: nq.helpText as { en: string; ro: string } | null,
            type: nq.type,
            options: nq.options,
          },
          progress: nextResult.progress,
          groupType: activeGroupType,
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
// resume_application
// ─────────────────────────────────────────────

export const resumeApplication: ToolHandler = async (_args, context) => {
  try {
    const application = await context.db.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application || application.status !== 'PAUSED') {
      return {
        success: false,
        error: 'No paused application found to resume.',
      }
    }

    // Set to OPEN
    await context.db.application.update({
      where: { id: application.id },
      data: { status: 'OPEN' },
    })

    // Get next question
    const nextResult = await getNextQuestion(await appGroupCodes(context), { kind: 'conversation', conversationId: context.conversationId })

    if (!nextResult) {
      return {
        success: true,
        data: {
          applicationId: application.id,
          alreadyComplete: true,
          readyForQuote: true,
        },
        message: 'Application resumed. All questions already answered — ready for quote generation.',
      }
    }

    const lang = context.language ?? 'ro'
    const nq = nextResult.question
    const nqText = nq.text as { en: string; ro: string }

    return {
      success: true,
      data: {
        applicationId: application.id,
        resumed: true,
        currentQuestion: {
          id: nq.id,
          code: nq.code,
          text: nqText[lang],
          helpText: nq.helpText ? (nq.helpText as { en: string; ro: string })[lang] : null,
          type: nq.type,
          options: nq.options,
        },
        progress: nextResult.progress,
      },
      message: 'Application resumed. Let\'s continue where you left off.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// cancel_application
// ─────────────────────────────────────────────

export const cancelApplication: ToolHandler = async (args, context) => {
  const reason = (args.reason as string | undefined) ?? 'cancelled'

  try {
    const application = await context.db.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application || application.status === 'COMPLETED') {
      return {
        success: false,
        error: 'No active application found to cancel.',
      }
    }

    await context.db.application.update({
      where: { id: application.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    return {
      success: true,
      data: {
        applicationId: application.id,
        status: 'COMPLETED',
        reason,
      },
      message: 'Application cancelled.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
