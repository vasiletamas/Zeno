/**
 * DNT Handlers — Declaration of Needs and Testing
 *
 * Reads: get_dnt_state, get_dnt_questions, get_dnt_next_question (B2.4 —
 * the pinned #7 surface; session details are absorbed into get_dnt_state).
 * Commits: save_dnt_answer (legacy until B2.5), sign_dnt.
 */

import {
  getNextQuestion,
  validateAnswer,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { shouldShowQuestion } from '@/lib/engines/questionnaire-engine'
import { isDntValidFor, isExpiringOrExpired, type DntFact } from '@/lib/engines/dnt-rules'
import { appendConsentEvents } from '@/lib/customer/consent-service'
import type { ToolHandler } from '@/lib/tools/types'
import { trackDntCompleted } from '@/lib/analytics/events'
import { bumpInsightOnAnswer } from './insight-bump'

async function dntGroupCodes(context: { conversationId: string; product?: { id: string } }) {
  const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
  return resolveGroupCodes(productId, 'dnt')
}

// ─────────────────────────────────────────────
// get_dnt_state (B2.4 — absorbs session details, #7)
// ─────────────────────────────────────────────

export const getDntState: ToolHandler = async (_args, context) => {
  try {
    const now = new Date()
    const latest = await context.db.dnt.findFirst({
      where: { customerId: context.customerId },
      orderBy: { signedAt: 'desc' },
    })
    const session = await context.db.dntSession.findFirst({
      where: { customerId: context.customerId, status: 'ACTIVE' },
    })
    let sessionSummary: Record<string, unknown> | null = null
    if (session) {
      const codes = await resolveGroupCodes(session.productId, 'dnt')
      const progress = await calculateProgress(codes, { kind: 'dntSession', sessionId: session.id })
      sessionSummary = {
        id: session.id,
        type: session.type,
        answered: progress.answered,
        total: progress.total,
        startedAt: session.startedAt.toISOString(),
      }
    }
    const fact = latest as DntFact | null
    const valid = isDntValidFor(fact, 'LIFE', now)
    return {
      success: true,
      data: {
        valid,
        validUntil: latest?.validUntil.toISOString() ?? null,
        productTypesCovered: latest?.productTypesCovered ?? [],
        status: latest?.status ?? null,
        expiring: fact ? isExpiringOrExpired(fact, now) : false,
        expiringWithinDays: latest ? Math.max(0, Math.ceil((latest.validUntil.getTime() - now.getTime()) / 86400e3)) : null,
        session: sessionSummary,
      },
      message: valid
        ? 'A valid DNT covers this customer.'
        : sessionSummary
          ? 'No valid DNT; a questionnaire session is in progress.'
          : 'No valid DNT for this customer.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// get_dnt_questions (preview — no session required)
// ─────────────────────────────────────────────

export const getDntQuestions: ToolHandler = async (_args, context) => {
  try {
    const codes = await dntGroupCodes(context)
    const groups = await context.db.questionGroup.findMany({
      where: { code: { in: codes } },
      orderBy: { orderIndex: 'asc' },
    })
    const questions = await context.db.question.findMany({
      where: { groupId: { in: groups.map((g) => g.id) } },
      orderBy: [{ groupId: 'asc' }, { orderIndex: 'asc' }],
    })
    const groupCodeMap = new Map(groups.map((g) => [g.id, g.code]))
    const lang = context.language ?? 'ro'
    // visible-by-default: no answers yet, so only unconditional questions show
    const emptyAnswers = new Map<string, string>()
    const visible = questions
      .filter((q) => shouldShowQuestion({ parentQuestionId: q.parentQuestionId, showWhenValue: q.showWhenValue }, emptyAnswers))
      .map((q) => ({
        id: q.id,
        code: q.code,
        text: (q.text as { en: string; ro: string })[lang],
        type: q.type,
        options: q.options,
        groupCode: groupCodeMap.get(q.groupId) ?? '',
      }))
    return {
      success: true,
      data: { questions: visible },
      message: `${visible.length} DNT questions (more may appear based on answers).`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// get_dnt_next_question (steps the customer's ACTIVE session)
// ─────────────────────────────────────────────

export const getDntNextQuestion: ToolHandler = async (_args, context) => {
  try {
    const session = await context.db.dntSession.findFirst({
      where: { customerId: context.customerId, status: 'ACTIVE' },
    })
    if (!session) {
      return { success: false, error: 'no_active_dnt_session: open_dnt_session first.' }
    }
    const codes = await resolveGroupCodes(session.productId, 'dnt')
    const next = await getNextQuestion(codes, { kind: 'dntSession', sessionId: session.id })
    if (!next) {
      const progress = await calculateProgress(codes, { kind: 'dntSession', sessionId: session.id })
      return {
        success: true,
        data: { sessionId: session.id, complete: true, question: null, progress },
        message: 'All DNT questions answered. Ready for signature (sign_dnt).',
      }
    }
    const lang = context.language ?? 'ro'
    const q = next.question
    return {
      success: true,
      data: {
        sessionId: session.id,
        complete: false,
        question: {
          id: q.id,
          code: q.code,
          text: (q.text as { en: string; ro: string })[lang],
          helpText: q.helpText ? (q.helpText as { en: string; ro: string })[lang] : null,
          type: q.type,
          options: q.options,
          groupCode: q.groupCode,
        },
        progress: next.progress,
      },
      message: `Next DNT question (${next.progress.answered}/${next.progress.total} answered).`,
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
