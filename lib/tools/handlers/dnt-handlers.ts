/**
 * DNT Handlers — Declaration of Needs and Testing
 *
 * check_dnt_status, start_dnt_questionnaire, save_dnt_answer, sign_dnt
 */

import { prisma } from '@/lib/db'
import {
  getNextQuestion,
  validateAnswer,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import type { ToolHandler } from '@/lib/tools/types'
import { trackDntCompleted } from '@/lib/analytics/events'

// All DNT group codes in order
const DNT_GROUP_CODES = [
  'dnt_consent',
  'dnt_general',
  'dnt_life_type',
  'dnt_life_financial',
  'dnt_life_investment',
  'dnt_sustainability',
]

// ─────────────────────────────────────────────
// check_dnt_status
// ─────────────────────────────────────────────

export const checkDntStatus: ToolHandler = async (_args, context) => {
  try {
    const { conversationId } = context

    // Calculate progress across all DNT groups
    const progress = await calculateProgress(DNT_GROUP_CODES, conversationId)

    // Check WorkflowSession.data for signing metadata
    let isSigned = false
    let signedAt: string | null = null
    let validUntil: string | null = null

    if (context.workflowSession) {
      const session = await prisma.workflowSession.findUnique({
        where: { id: context.workflowSession.id },
      })
      if (session?.data) {
        const data = session.data as Record<string, unknown>
        if (data.dntSignedAt) {
          isSigned = true
          signedAt = data.dntSignedAt as string
          validUntil = (data.dntValidUntil as string) ?? null
        }
      }
    }

    return {
      success: true,
      data: {
        dntExists: progress.total > 0,
        completionPercentage: progress.percentage,
        answered: progress.answered,
        total: progress.total,
        isSigned,
        signedAt,
        validUntil,
      },
      message: isSigned
        ? 'DNT is signed and valid. Customer can proceed with applications.'
        : progress.percentage === 100
          ? 'All DNT questions answered. Ready for signature.'
          : `DNT progress: ${progress.percentage}% (${progress.answered}/${progress.total}).`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// start_dnt_questionnaire
// ─────────────────────────────────────────────

export const startDntQuestionnaire: ToolHandler = async (_args, context) => {
  try {
    const result = await getNextQuestion(DNT_GROUP_CODES, context.conversationId)

    if (!result) {
      return {
        success: true,
        data: { alreadyComplete: true },
        message: 'All DNT questions have already been answered. Ready for signature.',
      }
    }

    const lang = context.language ?? 'ro'
    const q = result.question
    const text = q.text as { en: string; ro: string }

    return {
      success: true,
      data: {
        currentQuestion: {
          id: q.id,
          code: q.code,
          text: text[lang],
          helpText: q.helpText ? (q.helpText as { en: string; ro: string })[lang] : null,
          type: q.type,
          options: q.options,
          groupCode: q.groupCode,
        },
        progress: result.progress,
      },
      message: `Started DNT questionnaire. ${result.progress.total} questions total.`,
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
          groupType: 'dnt',
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// save_dnt_answer
// ─────────────────────────────────────────────

export const saveDntAnswer: ToolHandler = async (args, context) => {
  const answer = args.answer as string
  const questionIdArg = args.questionId as string | undefined

  try {
    // Resolve current question
    let questionId = questionIdArg
    let questionMeta: { type: string; options: unknown; validationRules: unknown } | null = null

    if (questionId) {
      const q = await prisma.question.findUnique({ where: { id: questionId } })
      if (!q) return { success: false, error: 'Question not found.' }
      questionMeta = { type: q.type, options: q.options, validationRules: q.validationRules }
    } else {
      const next = await getNextQuestion(DNT_GROUP_CODES, context.conversationId)
      if (!next) {
        return { success: false, error: 'All DNT questions have already been answered.' }
      }
      questionId = next.question.id
      questionMeta = {
        type: next.question.type,
        options: next.question.options,
        validationRules: next.question.validationRules,
      }
    }

    // Validate
    const validation = validateAnswer(questionMeta, answer)
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid answer.' }
    }

    // Upsert answer
    await prisma.answer.upsert({
      where: {
        questionId_conversationId: {
          questionId: questionId!,
          conversationId: context.conversationId,
        },
      },
      create: {
        questionId: questionId!,
        conversationId: context.conversationId,
        value: validation.normalizedValue,
      },
      update: {
        value: validation.normalizedValue,
        answeredAt: new Date(),
      },
    })

    // Get next question
    const nextResult = await getNextQuestion(DNT_GROUP_CODES, context.conversationId)

    if (!nextResult) {
      return {
        success: true,
        data: {
          answerSaved: true,
          isComplete: true,
          needsSignature: true,
        },
        message: 'All DNT questions answered. Ready for signature.',
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
          groupCode: nq.groupCode,
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
          groupType: 'dnt',
        } as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// sign_dnt
// ─────────────────────────────────────────────

export const signDnt: ToolHandler = async (args, context) => {
  const confirmSignature = args.confirmSignature as boolean
  const gdprConsent = args.gdprConsent as boolean

  try {
    if (!confirmSignature) {
      return { success: false, error: 'Signature confirmation is required.' }
    }
    if (!gdprConsent) {
      return { success: false, error: 'GDPR consent is required to sign the document.' }
    }

    // Verify all DNT questions answered
    const progress = await calculateProgress(DNT_GROUP_CODES, context.conversationId)
    if (progress.percentage < 100) {
      return {
        success: false,
        error: `Cannot sign: ${progress.total - progress.answered} question(s) still need answers.`,
      }
    }

    // Save signing data to WorkflowSession.data
    if (!context.workflowSession) {
      return { success: false, error: 'No active workflow session found.' }
    }

    const now = new Date()
    const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    // Read existing data and merge
    const session = await prisma.workflowSession.findUnique({
      where: { id: context.workflowSession.id },
    })
    const existingData = (session?.data ?? {}) as Record<string, unknown>

    await prisma.workflowSession.update({
      where: { id: context.workflowSession.id },
      data: {
        data: {
          ...existingData,
          dntSignedAt: now.toISOString(),
          dntSignatureConfirmed: true,
          dntGdprConsent: true,
          dntValidUntil: validUntil.toISOString(),
        },
      },
    })

    trackDntCompleted(context.customerId)

    return {
      success: true,
      data: {
        signed: true,
        signedAt: now.toISOString(),
        validUntil: validUntil.toISOString(),
      },
      message: 'DNT successfully signed. Customer can now proceed with insurance applications.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
