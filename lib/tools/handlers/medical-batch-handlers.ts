/**
 * write_medical_batch (T10, ruling: option c) — the ONE-card bulk medical
 * declaration. The six BD_* BOOLEAN conditions render as a single
 * show_medical_batch card whose primary action ("Niciuna dintre acestea nu
 * mi se aplică") answers all six No and whose toggles handle exceptions;
 * this handler writes those answers with PER-QUESTION semantics inside ONE
 * gateway commit: the same computeConsequences/applyConsequencePlan pair the
 * sequential write_question_answer path uses, applied SEQUENTIALLY in card
 * order with the planner snapshot rebuilt between writes (answers change
 * visibility/eligibility — a 'true' fires the addon ELIGIBILITY edges,
 * selectionPatch.addon=false hides the remaining BD questions, and those
 * entries are SKIPPED exactly as the sequential path would never reach
 * them). Ledgered once (targetRef app_answers_batch:<applicationId>). The
 * SIGNED affirmation stays sign_medical_declarations over the same revision
 * hash — the batch card answers, the review card confirms (clause 6 still
 * yields exactly one confirmation). The typed per-question fallback
 * (write_question_answer) stays untouched.
 */
import { getNextQuestion, validateAnswer, calculateProgress } from '@/lib/engines/questionnaire-engine'
import { computeConsequences } from '@/lib/engines/consequence-planner'
import { applyConsequencePlan, buildPlannerSnapshot, loadDependencyGraph } from '@/lib/engines/consequence-applier'
import { computeVisibleSet } from '@/lib/engines/dependency-graph'
import type { CommitEffect } from '@/lib/engines/domain-types'
import { appGroupCodesFor, loadActiveApplication } from './application-handlers'
import { applicationCompletion, medicalBatchCard, questionCard, rejectReemit, savedMessage } from './questionnaire-cards'
import { bumpInsightOnAnswer } from './insight-bump'
import type { ToolHandler } from '@/lib/tools/types'

export const writeMedicalBatch: ToolHandler = async (args, context) => {
  const answers = args.answers as Record<string, string>

  try {
    const application = await loadActiveApplication(context)
    if (!application || application.status !== 'OPEN') {
      return { success: false, error: 'No open application found. Please set an application first.' }
    }

    const activeGroupCodes = await appGroupCodesFor(context, application.includesAddon)
    const scope = { kind: 'application' as const, applicationId: application.id }
    const progress = await calculateProgress(activeGroupCodes, scope, context.db)

    // The entry card doubles as the clause-3 reject re-emission: a rejection
    // rolls the tx back, so the pre-write card IS the current card.
    const entryCard = await medicalBatchCard(context.db, application.id, progress)
    const visibleBdCodes = entryCard.payload.conditions.map((c) => c.code)
    const reemit = () => rejectReemit(undefined, entryCard)

    const codes = Object.keys(answers)
    if (codes.length === 0) {
      return { success: false, error: 'invalid_args: answers must contain at least one BD question code.', data: reemit() }
    }
    const unknown = codes.filter((c) => !visibleBdCodes.includes(c))
    if (unknown.length > 0) {
      return {
        success: false,
        error: `invalid_args: not visible BD medical questions: ${unknown.join(', ')}. Valid codes: ${visibleBdCodes.join(', ')}.`,
        data: reemit(),
      }
    }

    // NO grounding guard (P0-1) — deliberate: the values are the
    // 'true'/'false' option literals of BOOLEAN questions, the exact
    // semantic of an option CLICK (the zod schema already constrains the
    // value space to those two literals), so there is nothing fabricable to
    // anchor; the gui actor bypasses the guard anyway and an agent call can
    // only relay which of two options the customer picked.

    // T6.D3/P2.4 confirmation pre-pass: only MODIFICATIONS confirm (first
    // writes are free). Computed over the ENTRY snapshot BEFORE any write so
    // the requiresConfirmation contract holds (the handler wrote nothing) —
    // an earlier batch write can only REMOVE answers for other codes, never
    // add them, so the entry-state check is a sound superset of the
    // per-write planner verdicts. gui actors are confirmed by construction.
    const graph = await loadDependencyGraph(context.db, application.productId)
    const entrySnapshot = await buildPlannerSnapshot(context.db, context.conversationId)
    const modifying = codes.filter((c) => entrySnapshot.answers.active[c] !== undefined)
    if (modifying.length > 0 && !context.confirmed) {
      return { success: false, requiresConfirmation: { preview: { answers, modifying } } }
    }

    // Sequential application in CARD order, snapshot rebuilt between writes.
    const applied: string[] = []
    const skipped: string[] = []
    const effects = new Set<CommitEffect>()
    const aggregate = {
      questionsAdded: [] as string[],
      questionsRemoved: [] as string[],
      invalidations: [] as unknown[],
      eligibilityOutcomes: [] as unknown[],
    }
    for (const code of visibleBdCodes) {
      const value = answers[code]
      if (value === undefined) continue

      const stepSnapshot = await buildPlannerSnapshot(context.db, context.conversationId)
      const stepVisible = computeVisibleSet(graph, stepSnapshot.questionCodes, { answers: stepSnapshot.answers.active, selection: stepSnapshot.selection })
      if (!stepVisible.has(code)) {
        // an earlier batch answer removed this question (addon flipped off) —
        // the sequential path would never have reached it either
        skipped.push(code)
        continue
      }

      const question = await context.db.question.findFirstOrThrow({ where: { code } })
      const validation = validateAnswer({ type: question.type, options: question.options, validationRules: question.validationRules }, value)
      if (!validation.valid) {
        return { success: false, error: validation.error ?? 'Invalid answer.', data: reemit() }
      }

      const plan = computeConsequences(graph, stepSnapshot, { node: `answer:${code}`, newValue: validation.normalizedValue })
      if (plan.requiresConfirmation && !context.confirmed) {
        // unreachable belt: the pre-pass verdict is a superset of the
        // per-write planner verdicts (see comment above)
        return { success: false, requiresConfirmation: { preview: { answers, modifying } } }
      }
      await applyConsequencePlan(context.db, {
        conversationId: context.conversationId,
        applicationId: application.id,
        commitId: context.commitId ?? crypto.randomUUID(),
      }, plan)

      if (question.insightKey) {
        const priorInsight = await context.db.customerInsight.findUnique({
          where: { customerId_key: { customerId: context.customerId, key: question.insightKey } },
        })
        const group = await context.db.questionGroup.findUniqueOrThrow({ where: { id: question.groupId }, select: { code: true } })
        await bumpInsightOnAnswer({
          customerId: context.customerId,
          conversationId: context.conversationId,
          question: { id: question.id, code: question.code, insightKey: question.insightKey, group: { code: group.code } },
          answerValue: validation.normalizedValue,
          previousInsightValue: priorInsight?.value,
          previousInsightCategory: priorInsight?.category,
          productId: context.product?.id ?? null,
        })
      }

      applied.push(code)
      for (const e of plan.effects) effects.add(e)
      aggregate.questionsAdded.push(...plan.questionsAdded)
      aggregate.questionsRemoved.push(...plan.questionsRemoved)
      aggregate.invalidations.push(...plan.invalidations)
      aggregate.eligibilityOutcomes.push(...plan.eligibilityOutcomes)
    }

    // parity with write_question_answer: one position bump per applied write
    if (applied.length > 0) {
      await context.db.application.update({
        where: { id: application.id },
        data: { currentQuestionIndex: application.currentQuestionIndex + applied.length },
      })
    }

    // derived flag escalation (erratum 10) — same surface as the sequential
    // path; BD answers carry no flagAnswers today, but the applier's flag
    // recompute is authoritative, never this handler.
    const postApp = await context.db.application.findUniqueOrThrow({ where: { id: application.id } })
    if (postApp.status === 'PAUSED') {
      const escalated = (postApp.flagsForReview as unknown as Array<{ questionCode?: string; reason?: string; action?: string }> ?? [])
        .find((f) => f.action === 'escalate')
      return {
        success: true,
        effects: [...effects],
        data: { answersSaved: applied, skipped, escalated: true, reason: escalated?.reason ?? null, applicationId: application.id, ...aggregate },
        message: `Application paused for review. ${escalated?.reason ?? 'An answer requires human review.'}`,
      }
    }

    // the addon may have flipped (eligibility) — recompute the group codes so
    // the next-question walk follows the new branch (context.db throughout:
    // the global client cannot see the just-applied writes inside the tx).
    const postGroupCodes = await appGroupCodesFor(context, postApp.includesAddon)
    const nextResult = await getNextQuestion(postGroupCodes, scope, undefined, context.db)
    if (!nextResult) {
      // clause 5: the SAME completion the sequential path surfaces — the
      // medical review/sign card rides the batch result when declarations
      // are pending signature (shared applicationCompletion, T11).
      const completion = await applicationCompletion(context.db, postApp)
      return {
        success: true,
        effects: [...effects],
        data: { answersSaved: applied, skipped, isComplete: true, applicationId: application.id, readyForQuote: true, ...aggregate },
        message: completion.message,
        uiAction: completion.uiAction,
      }
    }

    // partial batch: the pending card rides the commit — the batch card again
    // when the next question is still a BD_* code, the single-question card
    // otherwise (T9 clause 1 shape).
    const nq = nextResult.question
    return {
      success: true,
      effects: [...effects],
      data: {
        answersSaved: applied,
        skipped,
        isComplete: false,
        nextQuestionCode: nq.code,
        progress: nextResult.progress,
        ...aggregate,
      },
      message: savedMessage('application', nq, nextResult.progress),
      uiAction: nq.code?.startsWith('BD_')
        ? await medicalBatchCard(context.db, application.id, nextResult.progress)
        : questionCard('application', nq, nextResult.progress),
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
