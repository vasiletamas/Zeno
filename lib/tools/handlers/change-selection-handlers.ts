/**
 * change_selection — modify tier/level/addon on the existing application
 * (same product). Expires any DRAFT quote so a fresh one is generated.
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

export const changeSelection: ToolHandler = async (args, context) => {
  const tierArg = args.tier as string | undefined
  const levelArg = args.level as string | undefined
  const addonArg = args.addon as boolean | undefined

  try {
    // Must come BEFORE the application lookup, and its message must read as "no changes".
    if (!tierArg && !levelArg && addonArg === undefined) {
      return { success: false, error: 'No changes requested. Specify at least one of tier, level, or addon.' }
    }

    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
    })
    if (!application) {
      return { success: false, error: 'No application found for this conversation.' }
    }

    const updateData: Record<string, unknown> = {}
    const answerUpserts: Array<{ code: string; value: string }> = []
    let tierChanged = false
    let levelChanged = false
    let addonChanged = false
    let newTierId: string | null = null
    let newTierCode: string | null = null
    let newLevelId: string | null = null
    let newLevelCode: string | null = null

    if (tierArg) {
      const tier = await prisma.pricingTier.findFirst({
        where: { productId: application.productId, code: tierArg },
      })
      if (!tier) {
        return { success: false, error: `Pricing tier "${tierArg}" not found for this product.` }
      }
      newTierId = tier.id
      newTierCode = tier.code
      if (application.tierId !== newTierId) {
        tierChanged = true
        updateData.tierId = newTierId
        answerUpserts.push({ code: 'PACKAGE_CHOICE', value: newTierCode })
      }
    }

    if (levelArg) {
      // Level codes are only unique within a tier; scope by the effective tier.
      const effectiveTierId = newTierId ?? application.tierId
      const level = await prisma.pricingLevel.findFirst({
        where: { tierId: effectiveTierId ?? undefined, code: levelArg },
      })
      if (!level) {
        return { success: false, error: `Pricing level "${levelArg}" not found for the selected tier.` }
      }
      newLevelId = level.id
      newLevelCode = level.code
      if (application.levelId !== newLevelId) {
        levelChanged = true
        updateData.levelId = newLevelId
        answerUpserts.push({ code: 'PREMIUM_LEVEL', value: newLevelCode })
      }
    }

    if (addonArg !== undefined && application.includesAddon !== addonArg) {
      addonChanged = true
      updateData.includesAddon = addonArg
      answerUpserts.push({ code: 'BD_ADDON_INTEREST', value: String(addonArg) })
    }

    // Nothing actually changed → success, no mutations, no quote expiry.
    if (!tierChanged && !levelChanged && !addonChanged) {
      return {
        success: true,
        data: { selectionChanged: false, applicationId: application.id, message: 'No changes detected.' },
      }
    }

    // Expire any existing DRAFT quote (exactly once).
    const existingQuote = await prisma.quote.findUnique({ where: { applicationId: application.id } })
    const quoteExpired = !!existingQuote && existingQuote.status === 'DRAFT'
    if (quoteExpired && existingQuote) {
      await prisma.quote.update({ where: { id: existingQuote.id }, data: { status: 'EXPIRED' } })
    }

    // Upsert the selection answers for the changed fields.
    if (answerUpserts.length > 0) {
      const questionCodes = answerUpserts.map((a) => a.code)
      const questions = await prisma.question.findMany({ where: { code: { in: questionCodes } } })
      const questionByCode = new Map(questions.map((q) => [q.code, q]))
      for (const a of answerUpserts) {
        const q = questionByCode.get(a.code)
        if (q) {
          await prisma.answer.upsert({
            where: { questionId_conversationId: { questionId: q.id, conversationId: context.conversationId } },
            create: { questionId: q.id, conversationId: context.conversationId, value: a.value },
            update: { value: a.value, answeredAt: new Date() },
          })
        }
      }
    }

    await prisma.application.update({ where: { id: application.id }, data: updateData })

    const changes: string[] = []
    if (tierChanged) changes.push(`tier: ${newTierCode}`)
    if (levelChanged) changes.push(`level: ${newLevelCode}`)
    if (addonChanged) changes.push(`addon: ${addonArg}`)

    return {
      success: true,
      data: {
        selectionChanged: true,
        applicationId: application.id,
        tierCode: newTierCode,
        levelCode: newLevelCode,
        addonIncluded: addonArg,
        quoteExpired,
      },
      message: `Selection updated: ${changes.join(', ')}. A new quote will be generated on your next request.`,
      confirmation: {
        category: 'lifecycle',
        label: `Selection updated: ${changes.join(', ')}`,
        value: changes.join('; '),
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
