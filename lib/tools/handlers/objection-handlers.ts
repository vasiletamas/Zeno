/**
 * Objection Handlers
 *
 * get_objection_strategy
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// get_objection_strategy
// ─────────────────────────────────────────────

export const getObjectionStrategy: ToolHandler = async (args, context) => {
  const objectionType = args.objectionType as string

  try {
    // Get the conversation's product
    const conversation = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { productId: true },
    })

    if (!conversation?.productId) {
      return {
        success: true,
        data: { hasStrategy: false },
        message:
          'No product selected for this conversation. Use general sales training to address the concern with empathy and factual information.',
      }
    }

    // Load ObjectionStrategy for this product and type
    const strategy = await prisma.objectionStrategy.findUnique({
      where: {
        productId_type: {
          productId: conversation.productId,
          type: objectionType,
        },
      },
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

    message +=
      '\n\n[Adapt this strategy to match the conversation tone and the customer\'s specific situation.]'

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
