/**
 * Objection Handlers
 *
 * get_objection_strategy
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// Pack → insuranceType mapping for the fallback chain
// ─────────────────────────────────────────────
const PACK_TO_INSURANCE_TYPE: Record<string, string> = {
  'life-insurance-discovery': 'LIFE',
  'life-insurance-closing': 'LIFE',
}

// ─────────────────────────────────────────────
// get_objection_strategy
// ─────────────────────────────────────────────

export const getObjectionStrategy: ToolHandler = async (args, context) => {
  const objectionType = args.objectionType as string

  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { productId: true, candidateProductId: true },
    })

    // Lookup order: productId → candidateProductId → pack-inferred unique catalog match
    let productId: string | null = conversation?.productId ?? null
    if (!productId) productId = conversation?.candidateProductId ?? null

    if (!productId) {
      const activePacks = (context as { activeSkillPacks?: string[] }).activeSkillPacks ?? []
      const insuranceTypes = new Set<string>()
      for (const slug of activePacks) {
        const t = PACK_TO_INSURANCE_TYPE[slug]
        if (t) insuranceTypes.add(t)
      }
      if (insuranceTypes.size > 0) {
        const candidates = await prisma.product.findMany({
          where: { isActive: true, insuranceType: { in: Array.from(insuranceTypes) } },
          select: { id: true, insuranceType: true },
        })
        if (candidates.length === 1) productId = candidates[0].id
      }
    }

    if (!productId) {
      return {
        success: true,
        data: { hasStrategy: false },
        message:
          'No product selected for this conversation. Use general sales training to address the concern with empathy and factual information.',
      }
    }

    const strategy = await prisma.objectionStrategy.findUnique({
      where: { productId_type: { productId, type: objectionType } },
    })

    if (!strategy || !strategy.isActive) {
      return {
        success: true,
        data: { hasStrategy: false, objectionType },
        message:
          'No specific objection strategy configured for this type. Use general sales training and the product playbook to address the concern with empathy and factual information.',
      }
    }

    let message = `[OBJECTION HANDLING STRATEGY: ${strategy.title}]\n\n${strategy.strategy}`
    if (strategy.addonContext) {
      message += `\n\n[ADDON CONTEXT: ${strategy.addonContext}]`
    }
    message += '\n\n[Adapt this strategy to match the conversation tone and the customer\'s specific situation.]'

    return {
      success: true,
      data: {
        hasStrategy: true,
        objectionType,
        title: strategy.title,
        strategyText: strategy.strategy,
        addonContext: strategy.addonContext,
      },
      message,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
