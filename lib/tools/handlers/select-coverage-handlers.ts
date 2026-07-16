/**
 * select_coverage (B4.4, planner-routed in C1.6) — THE selection writer
 * (T5.D2): tier, level and addon are Application columns, never Answer
 * rows. One facet per commit (arg-validation rule, contradiction #4): the
 * consequence planner computes everything the change drags along — the
 * VALIDITY-invalidated level on a tier change, the BD questionnaire
 * expanding/contracting on the addon toggle (answers invalidated with
 * causality, never deleted), re_rating. The planner only ever patches
 * selection via its own selectionPatch inside this same gateway
 * transaction, so the single-writer invariant holds.
 */
import { appGroupCodesFor, loadActiveApplication } from './application-handlers'
import { computeConsequences, type Mutation } from '@/lib/engines/consequence-planner'
import { applyConsequencePlan, buildPlannerSnapshot, loadDependencyGraph } from '@/lib/engines/consequence-applier'
import { getNextQuestion } from '@/lib/engines/questionnaire-engine'
import { CONDUCT_LINE, medicalBatchCard, questionCard, type MedicalBatchCardAction, type QuestionCardAction } from './questionnaire-cards'
import type { ToolHandler } from '@/lib/tools/types'

export const selectCoverage: ToolHandler = async (args, context) => {
  const tierCode = args.tier as string | undefined
  const levelCode = args.level as string | undefined
  const addon = args.addon as boolean | undefined

  try {
    const application = await loadActiveApplication(context)
    if (!application || application.status !== 'OPEN') {
      return { success: false, error: 'no_open_application: selection needs an OPEN application.' }
    }
    const facets = [tierCode !== undefined, levelCode !== undefined, addon !== undefined].filter(Boolean).length
    if (facets === 0) {
      return { success: false, error: 'invalid_args: pass one of tier, level, addon.' }
    }
    if (facets > 1) {
      return { success: false, error: 'one_facet_per_commit: change tier, level or addon in separate commits — each carries its own consequences.' }
    }

    // resolve the mutation + the handler's own column write
    let mutation: Mutation
    let write: { tierId?: string; levelId?: string; includesAddon?: boolean }
    if (tierCode !== undefined) {
      const tier = await context.db.pricingTier.findFirst({ where: { productId: application.productId, code: tierCode } })
      if (!tier) return { success: false, error: `invalid_args: tier "${tierCode}" does not exist for this product.` }
      mutation = { node: 'selection:tier', newValue: tierCode }
      write = { tierId: tier.id }
      if (tier.id === application.tierId) return unchanged(application.id)
    } else if (levelCode !== undefined) {
      if (!application.tierId) return { success: false, error: 'invalid_level_for_tier: choose a tier before the level.' }
      const level = await context.db.pricingLevel.findFirst({ where: { tierId: application.tierId, code: levelCode } })
      if (!level) return { success: false, error: `invalid_level_for_tier: level "${levelCode}" does not exist for the selected tier.` }
      mutation = { node: 'selection:level', newValue: levelCode }
      write = { levelId: level.id }
      if (level.id === application.levelId) return unchanged(application.id)
    } else {
      mutation = { node: 'selection:addon', newValue: String(addon) }
      write = { includesAddon: addon }
      if (addon === application.includesAddon) return unchanged(application.id)
    }

    const graph = await loadDependencyGraph(context.db, application.productId)
    const snapshot = await buildPlannerSnapshot(context.db, context.conversationId)
    const plan = computeConsequences(graph, snapshot, mutation)

    // the selection write itself, then the plan (whose selectionPatch may
    // null the VALIDITY-invalidated level) — one transaction, one writer
    await context.db.application.update({ where: { id: application.id }, data: write })
    await applyConsequencePlan(context.db, {
      conversationId: context.conversationId,
      applicationId: application.id,
      commitId: context.commitId ?? crypto.randomUUID(),
    }, plan)

    // D1.7 (T7.D1): no quote-expiry branch — a Quote row in ANY state makes
    // this commit engine-illegal (application_frozen) at legality, so the
    // handler never runs post-quote; the change path is cancel_quote + a new
    // application, never an in-place re-rate.

    const post = await context.db.application.findUniqueOrThrow({ where: { id: application.id } })
    // sequential: context.db is the gateway's single-connection tx client
    const tierRow = post.tierId ? await context.db.pricingTier.findUnique({ where: { id: post.tierId } }) : null
    const levelRow = post.levelId ? await context.db.pricingLevel.findUnique({ where: { id: post.levelId } }) : null

    // T9/T12 clause 1 — the questionnaire's ENTRY point: the commit that
    // leaves the selection COMPLETE carries the first pending question card
    // (nothing else emits it: get_next_question is a data-only read,
    // set_application emits nothing). "Selection complete" = tier AND level
    // chosen. includesAddon is a NOT NULL boolean @default(false) — there is
    // no "undecided" representation, so the addon facet cannot gate
    // completeness (treating default-false as undecided would strand the
    // flow: no later commit would ever emit the entry card).
    let entryCard: QuestionCardAction | MedicalBatchCardAction | undefined
    if (post.tierId && post.levelId && post.status === 'OPEN') {
      const codes = await appGroupCodesFor(context, post.includesAddon)
      // context.db, NOT the global client: the walk must see the plan the
      // gateway tx just applied (addon-toggle invalidations, added questions)
      const next = await getNextQuestion(codes, { kind: 'application', applicationId: application.id }, undefined, context.db)
      // T10: a BD_* entry (the addon toggle re-opening the questionnaire)
      // emits the ONE batch card instead of the single-question card.
      entryCard = next?.question.code?.startsWith('BD_')
        ? await medicalBatchCard(context.db, application.id, next.progress)
        : questionCard('application', next?.question ?? null, next?.progress ?? { answered: 0, total: 0 })
    }

    return {
      success: true,
      effects: plan.effects,
      data: {
        applicationId: application.id,
        selection: { tier: tierRow?.code ?? null, level: levelRow?.code ?? null, addon: post.includesAddon },
        changed: true,
        questionsAdded: plan.questionsAdded,
        questionsRemoved: plan.questionsRemoved,
        invalidations: plan.invalidations,
        eligibilityOutcomes: plan.eligibilityOutcomes,
      },
      // when the entry card rides, the message is selection summary + the
      // clause-2 conduct line; selection-complete-but-questionnaire-complete
      // keeps the bare summary (no card to narrate)
      message:
        `Selection updated: ${tierRow?.code ?? '—'} / ${levelRow?.code ?? '—'} / addon ${post.includesAddon ? 'on' : 'off'}.` +
        (plan.invalidations.some((i) => i.node === 'selection:level') ? ' The level was invalidated by the tier change — choose a level for the new tier.' : '') +
        (entryCard ? ` ${CONDUCT_LINE}` : ''),
      uiAction: entryCard,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

function unchanged(applicationId: string) {
  return {
    success: true,
    data: { applicationId, changed: false },
    message: 'Selection unchanged.',
  }
}
