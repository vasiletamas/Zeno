/**
 * DNT Handlers — Declaration of Needs and Testing
 *
 * Reads: get_dnt_state, get_dnt_questions, get_dnt_next_question (B2.4 —
 * the pinned #7 surface; session details are absorbed into get_dnt_state).
 * Commits: open_dnt_session, write_dnt_answer, sign_dnt (session-scoped).
 */

import {
  getNextQuestion,
  validateAnswer,
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { shouldShowQuestion } from '@/lib/engines/questionnaire-engine'
import { isDntValidFor, isExpiringOrExpired, decideSessionType, computeCoverage, DNT_VALIDITY_DAYS, type DntFact } from '@/lib/engines/dnt-rules'
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
// open_dnt_session (B2.5 — engine-decided NEW/UPDATE, prefill on UPDATE)
// ─────────────────────────────────────────────

export const openDntSession: ToolHandler = async (_args, context) => {
  try {
    // legality is engine-owned (dnt_session_already_active); this re-check
    // protects direct handler calls outside the gateway.
    const existing = await context.db.dntSession.findFirst({
      where: { customerId: context.customerId, status: 'ACTIVE' },
    })
    if (existing) return { success: false, error: `dnt_session_already_active: ${existing.id}` }

    const productId = await resolveActiveProductId(context.conversationId, context.product?.id)
    if (!productId) return { success: false, error: 'No product in focus for the DNT session.' }

    const latest = await context.db.dnt.findFirst({
      where: { customerId: context.customerId },
      orderBy: { signedAt: 'desc' },
    })
    const type = decideSessionType(latest as DntFact | null, new Date())
    const session = await context.db.dntSession.create({
      data: { customerId: context.customerId, productId, type, baseDntId: latest?.id ?? null, originConversationId: context.conversationId },
    })

    // UPDATE pre-fill: copy prior source-session answers whose question CODE
    // still exists in this product's dnt groups and whose value still passes
    // validation (T3 risk: code-matching, validation re-checked).
    let prefilled = 0
    if (type === 'UPDATE' && latest) {
      const codes = await resolveGroupCodes(productId, 'dnt')
      const groupQuestions = await context.db.question.findMany({ where: { group: { code: { in: codes } } } })
      const byCode = new Map(groupQuestions.filter((q) => q.code).map((q) => [q.code as string, q]))
      const priorAnswers = await context.db.dntAnswer.findMany({
        where: { sessionId: latest.sourceSessionId },
        include: { question: { select: { code: true } } },
      })
      for (const pa of priorAnswers) {
        const code = pa.question.code
        if (!code) continue
        const target = byCode.get(code)
        if (!target) continue
        const v = validateAnswer({ type: target.type, options: target.options, validationRules: target.validationRules }, pa.value)
        if (!v.valid) continue
        await context.db.dntAnswer.create({ data: { sessionId: session.id, questionId: target.id, value: v.normalizedValue } })
        prefilled++
      }
    }

    return {
      success: true,
      data: { sessionId: session.id, type, prefilled },
      message: type === 'NEW'
        ? 'DNT session opened — first analysis for this customer.'
        : `DNT session opened as an update; ${prefilled} prior answers pre-filled for review.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// write_dnt_answer (B2.5 — write-or-change; flat, never cascades, T3.D6)
// ─────────────────────────────────────────────

/**
 * Tx-aware next-question walk: getNextQuestion reads through the GLOBAL
 * client, which cannot see writes made inside the gateway transaction, so
 * the just-written answer would be re-served. This walk reads via
 * context.db (the tx when gateway-routed).
 */
async function sessionNextQuestion(
  db: Parameters<ToolHandler>[1]['db'],
  codes: string[],
  sessionId: string,
) {
  const groups = await db.questionGroup.findMany({ where: { code: { in: codes } }, orderBy: { orderIndex: 'asc' } })
  const questions = await db.question.findMany({ where: { groupId: { in: groups.map((g) => g.id) } } })
  const groupOrder = new Map(groups.map((g) => [g.id, g.orderIndex]))
  questions.sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) || a.orderIndex - b.orderIndex)
  const answers = await db.dntAnswer.findMany({ where: { sessionId }, select: { questionId: true, value: true } })
  const answersMap = new Map(answers.map((a) => [a.questionId, a.value]))
  let next: (typeof questions)[number] | null = null
  let total = 0
  let answered = 0
  for (const q of questions) {
    if (!shouldShowQuestion({ parentQuestionId: q.parentQuestionId, showWhenValue: q.showWhenValue }, answersMap)) continue
    total++
    if (answersMap.has(q.id)) answered++
    else if (!next) next = q
  }
  return { next, progress: { answered, total } }
}

export const writeDntAnswer: ToolHandler = async (args, context) => {
  const questionCode = args.questionCode as string
  const value = args.value as string
  try {
    const session = await context.db.dntSession.findFirst({
      where: { customerId: context.customerId, status: 'ACTIVE' },
    })
    if (!session) return { success: false, error: 'no_active_dnt_session: open_dnt_session first.' }

    const codes = await resolveGroupCodes(session.productId, 'dnt')
    const question = await context.db.question.findFirst({
      where: { code: questionCode, group: { code: { in: codes } } },
    })
    if (!question) {
      // Self-healing hint (B2.7 live lesson): agents sometimes guess codes —
      // hand back the CURRENT question's exact code so the retry lands.
      const { next } = await sessionNextQuestion(context.db, codes, session.id)
      return {
        success: false,
        error: `Unknown DNT question code: ${questionCode}. Use the exact code from the tool result — the current unanswered question is ${next?.code ?? '(none — session complete)'}.`,
      }
    }

    const v = validateAnswer({ type: question.type, options: question.options, validationRules: question.validationRules }, value)
    if (!v.valid) return { success: false, error: v.error ?? 'Invalid answer.' }

    await context.db.dntAnswer.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
      create: { sessionId: session.id, questionId: question.id, value: v.normalizedValue },
      update: { value: v.normalizedValue, answeredAt: new Date() },
    })

    const { next, progress } = await sessionNextQuestion(context.db, codes, session.id)
    const lang = context.language ?? 'ro'
    return {
      success: true,
      data: {
        answerSaved: true,
        sessionId: session.id,
        complete: next === null,
        nextQuestion: next
          ? {
              id: next.id,
              code: next.code,
              text: (next.text as { en: string; ro: string })[lang],
              type: next.type,
              options: next.options,
            }
          : null,
        progress,
      },
      message: next === null
        ? 'All DNT questions answered. Ready for signature (sign_dnt).'
        : `Answer saved. ${progress.total - progress.answered} questions remaining.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// sign_dnt (B2.6 — session-scoped; creates the customer Dnt aggregate)
// ─────────────────────────────────────────────

export const signDnt: ToolHandler = async (args, context) => {
  const confirmSignature = args.confirmSignature as boolean
  const consent = args.consent as { gdpr?: boolean; aiDisclosure?: boolean } | undefined

  try {
    if (!confirmSignature) {
      return { success: false, error: 'Signature confirmation is required.' }
    }
    // B1.5 (contradiction #2): sign_dnt is the sole consent-capturing commit.
    // Refusal never destroys progress — the session stays ACTIVE and signable.
    if (!consent?.gdpr || !consent?.aiDisclosure) {
      return {
        success: false,
        error: 'requires_consent: both GDPR processing consent and AI-disclosure acknowledgment are required to sign; your answers are preserved.',
      }
    }

    const session = await context.db.dntSession.findFirst({
      where: { customerId: context.customerId, status: 'ACTIVE' },
    })
    if (!session) {
      return { success: false, error: 'no_active_dnt_session: open_dnt_session first.' }
    }

    // Sign-time completeness over the SESSION scope with visibility
    // recomputation — answers hidden by the current answer set are excluded
    // (T3.D6 sign-time exclusion).
    const codes = await resolveGroupCodes(session.productId, 'dnt')
    const { next, progress } = await sessionNextQuestion(context.db, codes, session.id)
    if (next !== null || progress.total === 0) {
      return {
        success: false,
        error: `dnt_session_incomplete: ${progress.total - progress.answered} question(s) still need answers.`,
      }
    }

    const product = await context.db.product.findUniqueOrThrow({ where: { id: session.productId }, select: { insuranceType: true } })
    const now = new Date()
    const validUntil = new Date(now.getTime() + DNT_VALIDITY_DAYS * 86400e3)

    // All writes ride context.db — under the gateway this is the commit
    // transaction, so Dnt creation, supersession, session transition, and
    // consent events are atomic.
    const priorActive = await context.db.dnt.findFirst({
      where: { customerId: context.customerId, status: 'ACTIVE' },
      orderBy: { signedAt: 'desc' },
    })
    const dnt = await context.db.dnt.create({
      data: {
        customerId: context.customerId,
        signedAt: now,
        validUntil,
        productTypesCovered: computeCoverage(product.insuranceType as 'LIFE'),
        sourceSessionId: session.id,
      },
    })
    if (priorActive) {
      await context.db.dnt.update({ where: { id: priorActive.id }, data: { status: 'SUPERSEDED', supersededById: dnt.id } })
    }
    await context.db.dntSession.update({
      where: { id: session.id },
      data: { status: 'SIGNED', finishedAt: now },
    })

    // Consent capture (B1): gdpr + ai granted; the marketing preference is a
    // CUSTOMER-level fact — lift it out of the session answers so it never
    // stays trapped there (T3 divergence kill).
    const consentEvents: { kind: 'gdpr_processing' | 'ai_disclosure' | 'marketing'; action: 'granted' | 'withdrawn'; scope?: string }[] = [
      { kind: 'gdpr_processing', action: 'granted', scope: 'insurance_sales' },
      { kind: 'ai_disclosure', action: 'granted' },
    ]
    const marketingQuestion = await context.db.question.findFirst({ where: { code: 'DNT_MARKETING_CONSENT' } })
    if (marketingQuestion) {
      const marketingAnswer = await context.db.dntAnswer.findUnique({
        where: { sessionId_questionId: { sessionId: session.id, questionId: marketingQuestion.id } },
      })
      if (marketingAnswer) {
        const yes = ['true', 'yes', 'da', 'yes_all'].includes(marketingAnswer.value.toLowerCase())
        consentEvents.push({ kind: 'marketing', action: yes ? 'granted' : 'withdrawn' })
      }
    }
    await appendConsentEvents(context.customerId, consentEvents, undefined, context.db)

    trackDntCompleted(context.customerId)

    return {
      success: true,
      data: {
        signed: true,
        dntId: dnt.id,
        signedAt: now.toISOString(),
        validUntil: validUntil.toISOString(),
        productTypesCovered: dnt.productTypesCovered,
        supersededDntId: priorActive?.id ?? null,
        consentsRecorded: consentEvents.map((e) => e.kind),
      },
      message: 'DNT successfully signed. Customer can now proceed with insurance applications.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
