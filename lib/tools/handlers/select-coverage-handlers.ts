/**
 * select_coverage (B4.4) — THE selection writer (T5.D2): tier, level and
 * addon are Application columns, never Answer rows. Facet changes carry
 * typed effects: any change under a live DRAFT quote expires it
 * (re_rating); toggling the addon expands or removes the BD questionnaire
 * from the active set (#4 — answers are retained, just excluded).
 * The C1 consequence planner takes over effect computation when it lands;
 * until then the facts are the effects.
 */
import { loadActiveApplication } from './application-handlers'
import type { CommitEffect } from '@/lib/engines/domain-types'
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
    if (tierCode === undefined && levelCode === undefined && addon === undefined) {
      return { success: false, error: 'invalid_args: pass at least one of tier, level, addon.' }
    }

    // resolve tier (within the frozen product)
    let tierId = application.tierId
    if (tierCode !== undefined) {
      const tier = await context.db.pricingTier.findFirst({ where: { productId: application.productId, code: tierCode } })
      if (!tier) return { success: false, error: `invalid_args: tier "${tierCode}" does not exist for this product.` }
      if (tier.id !== application.tierId) {
        tierId = tier.id
        // levels are tier-scoped: a tier change invalidates a kept level
        if (levelCode === undefined) {
          // keep the level only if it also exists under the new tier by code
          const oldLevel = application.levelId ? await context.db.pricingLevel.findUnique({ where: { id: application.levelId } }) : null
          const carried = oldLevel ? await context.db.pricingLevel.findFirst({ where: { tierId: tier.id, code: oldLevel.code } }) : null
          application.levelId = carried?.id ?? null
        }
      }
    }

    // resolve level within the effective tier
    let levelId = application.levelId
    if (levelCode !== undefined) {
      if (!tierId) return { success: false, error: 'invalid_level_for_tier: choose a tier before the level.' }
      const level = await context.db.pricingLevel.findFirst({ where: { tierId, code: levelCode } })
      if (!level) return { success: false, error: `invalid_level_for_tier: level "${levelCode}" does not exist for the selected tier.` }
      levelId = level.id
    }

    const includesAddon = addon !== undefined ? addon : application.includesAddon

    const changed =
      tierId !== application.tierId ||
      levelId !== application.levelId ||
      includesAddon !== application.includesAddon

    const effects: CommitEffect[] = []
    if (addon !== undefined && addon !== application.includesAddon) {
      effects.push(addon ? 'cascade_expand' : 'questions_removed')
    }
    if (changed) {
      const draft = await context.db.quote.findFirst({
        where: { applicationId: application.id, status: 'DRAFT' },
      })
      if (draft) {
        await context.db.quote.update({ where: { id: draft.id }, data: { status: 'EXPIRED' } })
        effects.push('re_rating')
      }
    }

    await context.db.application.update({
      where: { id: application.id },
      data: { tierId, levelId, includesAddon },
    })

    const [tierRow, levelRow] = await Promise.all([
      tierId ? context.db.pricingTier.findUnique({ where: { id: tierId } }) : null,
      levelId ? context.db.pricingLevel.findUnique({ where: { id: levelId } }) : null,
    ])

    return {
      success: true,
      data: {
        applicationId: application.id,
        selection: { tier: tierRow?.code ?? null, level: levelRow?.code ?? null, addon: includesAddon },
        changed,
      },
      effects,
      message: changed
        ? `Selection updated: ${tierRow?.code ?? '—'} / ${levelRow?.code ?? '—'} / addon ${includesAddon ? 'on' : 'off'}.${effects.includes('re_rating') ? ' The previous quote expired — generate a fresh one.' : ''}`
        : 'Selection unchanged.',
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
