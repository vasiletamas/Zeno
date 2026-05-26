/**
 * Application Handlers
 *
 * start_application, save_application_answer, get_application_status,
 * resume_application, cancel_application
 */

import { prisma } from '@/lib/db'
import {
  getNextQuestion,
  validateAnswer,
  checkForFlags,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import type { ToolHandler } from '@/lib/tools/types'
import { trackProductSelected } from '@/lib/analytics/events'
import { bumpInsightOnAnswer } from './insight-bump'

const APPLICATION_GROUP_CODES = ['application']

// ─────────────────────────────────────────────
// start_application
// ─────────────────────────────────────────────

export const startApplication: ToolHandler = async (_args, context) => {
  try {
    // Verify DNT is signed
    if (context.workflowSession) {
      const session = await prisma.workflowSession.findUnique({
        where: { id: context.workflowSession.id },
      })
      const data = (session?.data ?? {}) as Record<string, unknown>
      if (!data.dntSignedAt) {
        return {
          success: false,
          error: 'DNT must be signed before starting an application.',
        }
      }
    }

    // Check no existing OPEN application for this conversation
    const existing = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })
    if (existing && existing.status === 'OPEN') {
      return {
        success: true,
        data: { alreadyExists: true, applicationId: existing.id },
        message: 'An open application already exists for this conversation.',
      }
    }

    // Resolve product from context or fall back to the conversation candidate
    let productId: string | null = context.product?.id ?? null
    if (!productId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: context.conversationId },
        select: { candidateProductId: true },
      })
      productId = conv?.candidateProductId ?? null
    }
    if (!productId) {
      return {
        success: false,
        error: 'No product selected. Call set_candidate_product first or pass an explicit productId.',
      }
    }

    // Calculate total questions for the application group
    const progress = await calculateProgress(APPLICATION_GROUP_CODES, context.conversationId)

    // Create Application record
    const application = await prisma.application.create({
      data: {
        conversationId: context.conversationId,
        customerId: context.customerId,
        productId,
        status: 'OPEN',
        currentQuestionIndex: 0,
        totalQuestions: progress.total,
      },
    })

    // Promote candidate to committed: copy productId onto Conversation so
    // future loaders read it directly and the derived phase becomes
    // 'application'.
    if (context.product?.id !== productId) {
      await prisma.conversation.update({
        where: { id: context.conversationId },
        data: { productId },
      })
    }

    // Get first question
    const result = await getNextQuestion(APPLICATION_GROUP_CODES, context.conversationId)
    if (!result) {
      return {
        success: false,
        error: 'No application questions configured.',
      }
    }

    const lang = context.language ?? 'ro'
    const q = result.question
    const text = q.text as { en: string; ro: string }

    return {
      success: true,
      data: {
        applicationStarted: true,
        applicationId: application.id,
        currentQuestion: {
          id: q.id,
          code: q.code,
          text: text[lang],
          helpText: q.helpText ? (q.helpText as { en: string; ro: string })[lang] : null,
          type: q.type,
          options: q.options,
        },
        progress: result.progress,
      },
      message: 'Application started. Let\'s begin with the first question.',
      uiAction: {
        type: 'show_question',
        payload: {
          question: {
            id: q.id,
            code: q.code,
            text: q.text as { en: string; ro: string },
            helpText: q.helpText as { en: string; ro: string } | null,
            type: q.type,
            options: q.options,
          },
          progress: result.progress,
          groupType: 'application',
        } as unknown as Record<string, unknown>,
      },
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
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })
    if (!application || application.status !== 'OPEN') {
      return {
        success: false,
        error: 'No open application found. Please start an application first.',
      }
    }

    // Determine active group codes based on workflow step
    // When the workflow step is BD-related, query bd_medical groups
    const isBdStep = context.workflowSession?.currentStepCode?.includes('bd') ?? false
    const activeGroupCodes = isBdStep ? ['bd_medical'] : APPLICATION_GROUP_CODES
    const activeGroupType = isBdStep ? 'bd_medical' : 'application'

    // Get current question
    const currentResult = await getNextQuestion(activeGroupCodes, context.conversationId)
    if (!currentResult) {
      return {
        success: true,
        data: { alreadyComplete: true, applicationId: application.id },
        message: 'All application questions have already been answered.',
      }
    }

    const currentQuestion = currentResult.question

    // Refetch question with group + insightKey (needed for insight bump)
    const questionMeta = await prisma.question.findUnique({
      where: { id: currentQuestion.id },
      include: { group: true },
    })

    // Capture pre-existing insight (if any) to detect confirmed/denied for bd_medical
    const priorInsight = questionMeta?.insightKey
      ? await prisma.customerInsight.findUnique({
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
      await prisma.answer.upsert({
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

      await prisma.application.update({
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
      await prisma.application.update({
        where: { id: application.id },
        data: {
          flagsForReview: JSON.parse(JSON.stringify([...existingFlags, newFlag])),
        },
      })
    }

    // Save answer
    await prisma.answer.upsert({
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
      const tier = await prisma.pricingTier.findFirst({
        where: { productId: application.productId, code: validation.normalizedValue },
      })
      if (tier) updateData.tierId = tier.id
      trackProductSelected(context.customerId, validation.normalizedValue, '')
    }

    if (effectiveCode === 'PREMIUM_LEVEL') {
      // Resolve PricingLevel by answer value (e.g., "level_1")
      if (application.tierId) {
        const level = await prisma.pricingLevel.findFirst({
          where: { tierId: application.tierId, code: validation.normalizedValue },
        })
        if (level) updateData.levelId = level.id
      }
      trackProductSelected(context.customerId, '', validation.normalizedValue)
    }

    if (effectiveCode === 'BD_ADDON_INTEREST') {
      updateData.includesAddon = validation.normalizedValue === 'true'
    }

    await prisma.application.update({
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
    const nextResult = await getNextQuestion(activeGroupCodes, context.conversationId)

    if (!nextResult) {
      // Mark application as COMPLETED
      await prisma.application.update({
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

// ─────────────────────────────────────────────
// get_application_status
// ─────────────────────────────────────────────

export const getApplicationStatus: ToolHandler = async (_args, context) => {
  try {
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application) {
      return {
        success: true,
        data: { hasApplication: false },
        message: 'No application found for this conversation.',
      }
    }

    const progress = await calculateProgress(APPLICATION_GROUP_CODES, context.conversationId)
    const flags = (application.flagsForReview as unknown as Array<Record<string, unknown>>) ?? []

    return {
      success: true,
      data: {
        hasApplication: true,
        applicationId: application.id,
        status: application.status,
        progress,
        tierId: application.tierId,
        levelId: application.levelId,
        includesAddon: application.includesAddon,
        flagsForReview: flags,
      },
      message: `Application status: ${application.status}. Progress: ${progress.percentage}%.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// resume_application
// ─────────────────────────────────────────────

export const resumeApplication: ToolHandler = async (_args, context) => {
  try {
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application || application.status !== 'PAUSED') {
      return {
        success: false,
        error: 'No paused application found to resume.',
      }
    }

    // Set to OPEN
    await prisma.application.update({
      where: { id: application.id },
      data: { status: 'OPEN' },
    })

    // Get next question
    const nextResult = await getNextQuestion(APPLICATION_GROUP_CODES, context.conversationId)

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
    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })

    if (!application || application.status === 'COMPLETED') {
      return {
        success: false,
        error: 'No active application found to cancel.',
      }
    }

    await prisma.application.update({
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
