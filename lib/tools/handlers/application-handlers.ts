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
  calculateProgress,
} from '@/lib/engines/questionnaire-engine'
import { resolveGroupCodes, resolveActiveProductId } from '@/lib/engines/question-groups'
import { canTransition, type AppStatus } from '@/lib/engines/application-rules'
import { computeConsequences, type ConsequencePlan } from '@/lib/engines/consequence-planner'
import { computeVisibleSet, type DependencyEdge, type GraphFacts } from '@/lib/engines/dependency-graph'
import { applyConsequencePlan, buildPlannerSnapshot, loadDependencyGraph } from '@/lib/engines/consequence-applier'
import { getActiveAnswers } from '@/lib/engines/answer-store'
import { buildBranchingMetadata } from '@/lib/engines/branching-provenance'
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
// get_next_question (C1.ADD-1) — the pinned questionnaire READ (T13.D1):
// next question + progress + structured branching provenance
// ─────────────────────────────────────────────

export const getNextQuestionInfo: ToolHandler = async (_args, context) => {
  try {
    const application = await loadActiveApplication(context)
    if (!application || application.status === 'CANCELLED') {
      return { success: false, error: 'no_open_application: set an application first.' }
    }
    const activeGroupCodes = await appGroupCodesFor(context, application.includesAddon)
    const scope = { kind: 'application' as const, applicationId: application.id }
    const nextResult = await getNextQuestion(activeGroupCodes, scope)
    if (!nextResult) {
      return {
        success: true,
        data: { isComplete: true, applicationId: application.id, readyForQuote: true },
        message: 'All application questions are answered.',
      }
    }
    const nq = nextResult.question
    const lang = context.language ?? 'ro'
    // provenance facts: active answers + current selection; "added by the
    // last commit" comes from the latest applied envelope's questionsAdded
    // (the C1.5 ledger persistence — reads have no in-hand plan).
    const graph = await loadDependencyGraph(context.db, application.productId)
    const activeAnswers = await getActiveAnswers(context.db, application.id)
    const tierRow = application.tierId ? await context.db.pricingTier.findUnique({ where: { id: application.tierId } }) : null
    const levelRow = application.levelId ? await context.db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null
    const lastApplied = await context.db.commitLedger.findFirst({
      where: { conversationId: context.conversationId, outcome: 'applied' },
      orderBy: { createdAt: 'desc' },
    })
    const lastAdded = ((lastApplied?.envelope as { data?: { questionsAdded?: string[] } } | null)?.data?.questionsAdded) ?? []
    const branchingMetadata = nq.code
      ? await buildQuestionProvenance(
          context,
          graph,
          { answers: activeAnswers, selection: { tier: tierRow?.code ?? null, level: levelRow?.code ?? null, addon: application.includesAddon } },
          { id: nq.id, code: nq.code },
          lastAdded,
        )
      : null
    return {
      success: true,
      data: {
        question: {
          id: nq.id,
          code: nq.code,
          text: (nq.text as { en: string; ro: string })[lang],
          helpText: nq.helpText ? (nq.helpText as { en: string; ro: string })[lang] : null,
          type: nq.type,
          options: nq.options,
          branching_metadata: branchingMetadata,
        },
        progress: nextResult.progress,
        ...(nextResult.suggestedAnswer !== undefined ? { suggestedAnswer: nextResult.suggestedAnswer } : {}),
      },
      message: `Next question: ${nq.code ?? nq.id} (${nextResult.progress.answered}/${nextResult.progress.total} answered).`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// write_question_answer (B4.1 re-key; C1.ADD-1 pinned name)
// ─────────────────────────────────────────────

export const writeQuestionAnswer: ToolHandler = async (args, context) => {
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

    if (!currentQuestion.code) {
      return { success: false, error: 'invalid_args: the current question has no code — cannot plan consequences.' }
    }
    // C1.9: when the caller addresses a question explicitly, it must be the
    // engine's current one — a mismatch means the flow moved (precise
    // recovery beats silently writing the wrong row).
    const claimedCode = args.questionCode as string | undefined
    if (claimedCode && claimedCode !== currentQuestion.code) {
      return { success: false, error: `invalid_args: the current question is ${currentQuestion.code}, not ${claimedCode} — answer it, or correct a past answer with modify_answer.` }
    }

    // C1.5: ONE planner path — sensitivity confirmation, cascades,
    // eligibility, derived flags/status all come from the plan.
    const graph = await loadDependencyGraph(context.db, application.productId)
    const snapshot = await buildPlannerSnapshot(context.db, context.conversationId)
    const plan = computeConsequences(graph, snapshot, { node: `answer:${currentQuestion.code}`, newValue: validation.normalizedValue })
    if (plan.requiresConfirmation && !context.confirmed) {
      return { success: false, requiresConfirmation: { preview: planPreview(plan) } }
    }
    await applyConsequencePlan(context.db, {
      conversationId: context.conversationId,
      applicationId: application.id,
      commitId: context.commitId ?? crypto.randomUUID(),
    }, plan)
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

    // derived flag escalation (erratum 10): the applier recomputed
    // flags/status from active revisions — surface a pause when it happened.
    const postApp = await context.db.application.findUniqueOrThrow({ where: { id: application.id } })
    if (postApp.status === 'PAUSED') {
      const escalated = (postApp.flagsForReview as unknown as Array<{ questionCode?: string; reason?: string; action?: string }> ?? [])
        .find((f) => f.action === 'escalate')
      return {
        success: true,
        effects: plan.effects,
        data: { answerSaved: true, escalated: true, reason: escalated?.reason ?? null, applicationId: application.id, ...planData(plan) },
        message: `Application paused for review. ${escalated?.reason ?? 'This answer requires human review.'}`,
      }
    }

    // the plan may have toggled the addon (eligibility) — recompute the
    // active group codes so the next question follows the new branch.
    const postGroupCodes = await appGroupCodesFor(context, postApp.includesAddon)
    const nextResult = await getNextQuestion(postGroupCodes, scope)
    if (!nextResult) {
      // Completeness is DERIVED (missingCodes = []) — the status machine
      // stays OPEN; generate_quote exposure turns on from the derived state.
      return {
        success: true,
        effects: plan.effects,
        data: { answerSaved: true, isComplete: true, applicationId: application.id, readyForQuote: true, ...planData(plan) },
        message: 'Application questionnaire complete. Choose coverage with select_coverage if not chosen, then generate the quote.',
      }
    }

    const lang = context.language ?? 'ro'
    const nq = nextResult.question
    const nqText = nq.text as { en: string; ro: string }
    // C1.7: structured provenance — why this question appeared (which edge
    // fired on which value) and whether THIS commit added it.
    const postSelection = {
      tier: plan.selectionPatch.tier !== undefined ? plan.selectionPatch.tier : snapshot.selection.tier,
      level: plan.selectionPatch.level !== undefined ? plan.selectionPatch.level : snapshot.selection.level,
      addon: plan.selectionPatch.addon !== undefined ? plan.selectionPatch.addon : postApp.includesAddon,
    }
    const postAnswers = await getActiveAnswers(context.db, application.id)
    const branchingMetadata = nq.code
      ? await buildQuestionProvenance(context, graph, { answers: postAnswers, selection: postSelection }, { id: nq.id, code: nq.code }, plan.questionsAdded)
      : null
    return {
      success: true,
      effects: plan.effects,
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
          branching_metadata: branchingMetadata,
        },
        progress: nextResult.progress,
        ...planData(plan),
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

/**
 * C1.7: build the next question's branching_metadata — the graph edges that
 * made it visible, localized gate texts (never paraphrased from memory) and
 * whether the last commit's cascade added it.
 */
async function buildQuestionProvenance(
  context: ToolContext,
  graph: DependencyEdge[],
  facts: GraphFacts,
  question: { id: string; code: string },
  lastCommitQuestionsAdded: string[],
) {
  const meta = await context.db.question.findUnique({ where: { id: question.id }, include: { group: true } })
  const gateCodes = graph
    .filter((e) => e.subjectKey === `answer:${question.code}` && e.dependsOnKey.startsWith('answer:'))
    .map((e) => e.dependsOnKey.slice('answer:'.length))
  const gates = gateCodes.length > 0
    ? await context.db.question.findMany({ where: { code: { in: gateCodes } }, select: { code: true, text: true } })
    : []
  const questionTexts = Object.fromEntries(gates.filter((g) => g.code).map((g) => [g.code as string, g.text as { en: string; ro: string }]))
  return buildBranchingMetadata({
    graph,
    questionCode: question.code,
    facts,
    questionTexts,
    lastCommitQuestionsAdded,
    groupCode: meta?.group.code ?? '',
    groupName: (meta?.group.name as { en: string; ro: string }) ?? { en: '', ro: '' },
  })
}

/** The planner outputs every answer-commit envelope carries (erratum 8). */
function planData(plan: ConsequencePlan): Record<string, unknown> {
  return {
    questionsAdded: plan.questionsAdded,
    questionsRemoved: plan.questionsRemoved,
    invalidations: plan.invalidations,
    eligibilityOutcomes: plan.eligibilityOutcomes,
  }
}

/** The requires_confirmation preview IS the plan (T6.D6). */
function planPreview(plan: ConsequencePlan): Record<string, unknown> {
  return { ...planData(plan), mutation: plan.mutation, selectionPatch: plan.selectionPatch, statusTransition: plan.statusTransition, effects: plan.effects }
}

// ─────────────────────────────────────────────
// modify_answer (C1.5) — planner-driven correction, no status-guard bypass
// ─────────────────────────────────────────────

export const modifyAnswer: ToolHandler = async (args, context) => {
  const questionCode = args.questionCode as string
  const newValue = args.newValue as string
  try {
    const application = await loadActiveApplication(context)
    if (!application) {
      return { success: false, error: 'no_open_application: no active application in this conversation.' }
    }
    if (application.status === 'REFERRED') {
      return { success: false, error: 'with_underwriter: the application is under review — answers cannot change until the underwriter answers.' }
    }
    if (application.status === 'CANCELLED') {
      return { success: false, error: 'illegal_status_transition: a CANCELLED application cannot be modified.' }
    }

    const graph = await loadDependencyGraph(context.db, application.productId)
    const snapshot = await buildPlannerSnapshot(context.db, context.conversationId)
    if (application.status === 'COMPLETED' && snapshot.application.quoteIssued) {
      return { success: false, error: 'quote_already_issued: modify the quote (modify_quote), not the sealed application.' }
    }
    if (!snapshot.questionCodes.includes(questionCode)) {
      return { success: false, error: `invalid_args: ${questionCode} is not part of this application's questionnaire.` }
    }
    const visible = computeVisibleSet(graph, snapshot.questionCodes, { answers: snapshot.answers.active, selection: snapshot.selection })
    if (!visible.has(questionCode)) {
      return { success: false, error: `removed_by_branch: ${questionCode} is not part of the current branch (check the coverage selection).` }
    }

    const question = await context.db.question.findFirstOrThrow({ where: { code: questionCode } })
    const validation = validateAnswer(
      { type: question.type, options: question.options, validationRules: question.validationRules },
      newValue,
    )
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Invalid answer.' }
    }

    const plan = computeConsequences(graph, snapshot, { node: `answer:${questionCode}`, newValue: validation.normalizedValue })
    if (plan.requiresConfirmation && !context.confirmed) {
      return { success: false, requiresConfirmation: { preview: planPreview(plan) } }
    }
    await applyConsequencePlan(context.db, {
      conversationId: context.conversationId,
      applicationId: application.id,
      commitId: context.commitId ?? crypto.randomUUID(),
    }, plan)

    const postApp = await context.db.application.findUniqueOrThrow({ where: { id: application.id } })
    return {
      success: true,
      effects: plan.effects,
      data: {
        answerModified: true,
        questionCode,
        value: validation.normalizedValue,
        applicationId: application.id,
        applicationStatus: postApp.status,
        ...planData(plan),
      },
      message: plan.invalidations.length > 0
        ? `Answer updated. ${plan.invalidations.length} dependent item(s) were invalidated — review them with the customer.`
        : 'Answer updated.',
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
    // confirmation via a real write_question_answer commit stamped now.
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
