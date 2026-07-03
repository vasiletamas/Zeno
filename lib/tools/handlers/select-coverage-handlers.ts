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
import { loadActiveApplication } from './application-handlers'
import { computeConsequences, type Mutation } from '@/lib/engines/consequence-planner'
import { applyConsequencePlan, buildPlannerSnapshot, loadDependencyGraph } from '@/lib/engines/consequence-applier'
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

    // any real change under a live DRAFT quote expires it (re_rating is
    // already in the plan's effects)
    const draft = await context.db.quote.findFirst({ where: { applicationId: application.id, status: 'ISSUED' } })
    if (draft) {
      await context.db.quote.update({ where: { id: draft.id }, data: { status: 'EXPIRED' } })
    }

    const post = await context.db.application.findUniqueOrThrow({ where: { id: application.id } })
    // sequential: context.db is the gateway's single-connection tx client
    const tierRow = post.tierId ? await context.db.pricingTier.findUnique({ where: { id: post.tierId } }) : null
    const levelRow = post.levelId ? await context.db.pricingLevel.findUnique({ where: { id: post.levelId } }) : null

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
      message:
        `Selection updated: ${tierRow?.code ?? '—'} / ${levelRow?.code ?? '—'} / addon ${post.includesAddon ? 'on' : 'off'}.` +
        (plan.invalidations.some((i) => i.node === 'selection:level') ? ' The level was invalidated by the tier change — choose a level for the new tier.' : '') +
        (draft ? ' The previous quote expired — generate a fresh one.' : ''),
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
