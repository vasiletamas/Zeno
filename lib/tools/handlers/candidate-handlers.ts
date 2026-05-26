/**
 * Candidate Product Handlers
 *
 * set_candidate_product — soft binding for the presentation phase.
 * See docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'

export const setCandidateProduct: ToolHandler = async (args, context) => {
  const productId = args.productId as string
  const confidence = args.confidence as number

  if (typeof productId !== 'string' || !productId) {
    return { success: false, error: 'productId is required.' }
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 100) {
    return { success: false, error: 'confidence must be an integer 0-100.' }
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

    const product = await prisma.product.findUnique({
      where: { id: ref.id },
      select: { id: true, name: true },
    })
    if (!product) {
      return { success: false, error: `Product not found: ${ref.id}` }
    }

    const current = await prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { candidateProductId: true, candidateConfidence: true },
    })

    const productLabel =
      typeof product.name === 'object' && product.name !== null
        ? ((product.name as Record<string, string>)[context.language ?? 'ro'] ?? productId)
        : String(product.name)

    if (
      current?.candidateProductId === ref.id &&
      current?.candidateConfidence === confidence
    ) {
      return {
        success: true,
        data: { candidateProductId: ref.id, candidateConfidence: confidence, unchanged: true },
        message: `Candidate already set to ${productLabel} (confidence ${confidence}). No change.`,
        confirmation: {
          category: 'lifecycle',
          label: 'Candidate product set',
          value: `${productLabel} (confidence ${confidence})`,
          timestamp: new Date().toISOString(),
        },
      }
    }

    await prisma.conversation.update({
      where: { id: context.conversationId },
      data: {
        candidateProductId: ref.id,
        candidateConfidence: confidence,
        candidateSetAt: new Date(),
      },
    })

    return {
      success: true,
      data: { candidateProductId: ref.id, candidateConfidence: confidence },
      message: `Candidate product set to ${productLabel} with confidence ${confidence}.`,
      confirmation: {
        category: 'lifecycle',
        label: 'Candidate product set',
        value: `${productLabel} (confidence ${confidence})`,
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
