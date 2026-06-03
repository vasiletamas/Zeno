/**
 * switch_product — change the active product within a conversation.
 * Resets application tier/level/addon (invalid for the new product),
 * expires any DRAFT quote, and recomputes totalQuestions. Shared answers
 * carry over automatically (Answer rows are keyed by Question).
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'
import { resolveGroupCodes } from '@/lib/engines/question-groups'
import { calculateProgress } from '@/lib/engines/questionnaire-engine'

export const switchProduct: ToolHandler = async (args, context) => {
  const productId = args.productId as string

  if (typeof productId !== 'string' || !productId) {
    return { success: false, error: 'productId is required.' }
  }

  try {
    const ref = await resolveProductRef({ productId })
    if (!ref) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error:
          `Product not found: "${productId}". ` +
          `Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
        data: { availableProducts: available as unknown as Record<string, unknown>[] },
      }
    }

    // Point the conversation at the new product.
    await prisma.conversation.update({
      where: { id: context.conversationId },
      data: { productId: ref.id },
    })

    const application = await prisma.application.findUnique({
      where: { conversationId: context.conversationId },
      select: {
        id: true,
        conversationId: true,
        productId: true,
        tierId: true,
        levelId: true,
        includesAddon: true,
        status: true,
        totalQuestions: true,
      },
    })

    if (application) {
      // Reset selection (invalid for the new product) and recompute totals.
      const codes = await resolveGroupCodes(ref.id, 'application')
      const progress = await calculateProgress(codes, context.conversationId)

      await prisma.application.update({
        where: { conversationId: context.conversationId },
        data: {
          tierId: null,
          levelId: null,
          includesAddon: false,
          totalQuestions: progress.total,
        },
      })
    }

    // Find the DRAFT quote (if any) belonging to this conversation's application
    // and expire it. Scoping through the application relation means this returns
    // null when no application exists. Only DRAFT is expired — ACCEPTED (already
    // in the CLOSING phase) is left intact. Status is re-checked explicitly.
    const draftQuote = await prisma.quote.findFirst({
      where: { application: { conversationId: context.conversationId }, status: 'DRAFT' },
      select: { id: true, status: true },
    })
    if (draftQuote && draftQuote.status === 'DRAFT') {
      await prisma.quote.update({
        where: { id: draftQuote.id },
        data: { status: 'EXPIRED' },
      })
    }

    return {
      success: true,
      data: { productId: ref.id, productCode: ref.code },
      message: `Switched to product ${ref.code}.`,
      confirmation: {
        category: 'lifecycle',
        label: `Product changed to ${ref.code}`,
        value: ref.code,
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
