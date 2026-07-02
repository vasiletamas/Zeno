/**
 * DNT Handlers — Declaration of Needs and Testing
 *
 * check_dnt_status, start_dnt_questionnaire, save_dnt_answer, sign_dnt
 */

import {
  getNextQuestion,
  validateAnswer,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { appendConsentEvents } from '@/lib/customer/consent-service'
import type { ToolHandler } from '@/lib/tools/types'
import { trackDntCompleted } from '@/lib/analytics/events'
import { bumpInsightOnAnswer } from './insight-bump'

async function dntGroupCodes(context: { conversationId: string; product?: { id: string } }) {
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  return resolveGroupCodes(productId, 'dnt')
}

// ─────────────────────────────────────────────
// check_dnt_status
// ─────────────────────────────────────────────

export const checkDntStatus: ToolHandler = async (_args, context) => {
  try {
    const { conversationId } = context

    // Calculate progress across all DNT groups
    const codes = await dntGroupCodes(context)
    const progress = await calculateProgress(codes, { kind: 'conversation', conversationId: conversationId })

    // Read signing state from Conversation
    const conv = await context.db.conversation.findUnique({
      where: { id: conversationId },
      select: { dntSignedAt: true, dntValidUntil: true },
    })
    const isSigned = !!conv?.dntSignedAt && (!conv.dntValidUntil || conv.dntValidUntil > new Date())
    const signedAt = conv?.dntSignedAt?.toISOString() ?? null
    const validUntil = conv?.dntValidUntil?.toISOString() ?? null

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
    const codes = await dntGroupCodes(context)
    const result = await getNextQuestion(codes, { kind: 'conversation', conversationId: context.conversationId })

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
    const codes = await dntGroupCodes(context)

    // Resolve current question
    let questionId = questionIdArg
    let questionMeta: { type: string; options: unknown; validationRules: unknown } | null = null

    if (questionId) {
      const q = await context.db.question.findUnique({ where: { id: questionId } })
      if (!q) return { success: false, error: 'Question not found.' }
      questionMeta = { type: q.type, options: q.options, validationRules: q.validationRules }
    } else {
      const next = await getNextQuestion(codes, { kind: 'conversation', conversationId: context.conversationId })
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

    // Refetch question with group + insightKey (needed for insight bump)
    const questionWithGroup = await context.db.question.findUnique({
      where: { id: questionId! },
      include: { group: true },
    })

    // Capture pre-existing insight (if any)
    const priorInsight = questionWithGroup?.insightKey
      ? await context.db.customerInsight.findUnique({
          where: {
            customerId_key: { customerId: context.customerId, key: questionWithGroup.insightKey },
          },
        })
      : null

    // Upsert answer
    await context.db.answer.upsert({
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

    // Bump insight + write compliance log (DNT v1 has no insightKeys, so this no-ops)
    if (questionWithGroup?.insightKey) {
      await bumpInsightOnAnswer({
        customerId: context.customerId,
        conversationId: context.conversationId,
        question: {
          id: questionWithGroup.id,
          code: questionWithGroup.code,
          insightKey: questionWithGroup.insightKey,
          group: { code: questionWithGroup.group.code },
        },
        answerValue: validation.normalizedValue,
        previousInsightValue: priorInsight?.value,
        previousInsightCategory: priorInsight?.category,
      })
    }

    // Get next question
    const nextResult = await getNextQuestion(codes, { kind: 'conversation', conversationId: context.conversationId })

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
  const consent = args.consent as { gdpr?: boolean; aiDisclosure?: boolean } | undefined

  try {
    if (!confirmSignature) {
      return { success: false, error: 'Signature confirmation is required.' }
    }
    // B1.5 (contradiction #2): sign_dnt is the sole consent-capturing commit.
    // Refusal never destroys progress — the session stays signable.
    if (!consent?.gdpr || !consent?.aiDisclosure) {
      return {
        success: false,
        error: 'requires_consent: both GDPR processing consent and AI-disclosure acknowledgment are required to sign; your answers are preserved.',
      }
    }

    // Verify all DNT questions answered
    const codes = await dntGroupCodes(context)
    const progress = await calculateProgress(codes, { kind: 'conversation', conversationId: context.conversationId })
    if (progress.percentage < 100) {
      return {
        success: false,
        error: `Cannot sign: ${progress.total - progress.answered} question(s) still need answers.`,
      }
    }

    const now = new Date()
    const validUntil = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    // Signature stamp + consent events land on the SAME client: under the
    // gateway this is the commit transaction, so the pair is atomic.
    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: { dntSignedAt: now, dntValidUntil: validUntil },
    })
    await appendConsentEvents(
      context.customerId,
      [
        { kind: 'gdpr_processing', action: 'granted', scope: 'insurance_sales' },
        { kind: 'ai_disclosure', action: 'granted' },
      ],
      undefined,
      context.db,
    )

    trackDntCompleted(context.customerId)

    return {
      success: true,
      data: {
        signed: true,
        signedAt: now.toISOString(),
        validUntil: validUntil.toISOString(),
        consentsRecorded: ['gdpr_processing', 'ai_disclosure'],
      },
      message: 'DNT successfully signed. Customer can now proceed with insurance applications.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
