/**
 * Candidate Product Handlers
 *
 * set_candidate_product — soft binding for the presentation phase.
 * See docs/superpowers/specs/2026-05-26-zeno-phase-model-design.md.
 */

import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'

export const setCandidateProduct: ToolHandler = async (args, context) => {
  const productId = args.productId as string
  // B4.ADD-1: soft addon interest replaces the confidence pseudo-metric
  const addonIds = Array.isArray(args.addonIds) ? (args.addonIds as string[]) : []

  if (typeof productId !== 'string' || !productId) {
    return { success: false, error: 'productId is required.' }
  }

  try {
    // The agent passes codes, ids, and (live runs cmr99s5cb/cmr9cq7e5) even
    // foreign cuids in this one slot — feed BOTH resolver paths so a code
    // resolves via code-exact/alias while a real id resolves via id.
    const ref = await resolveProductRef({ productId, productCode: productId })
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

    const product = await context.db.product.findUnique({
      where: { id: ref.id },
      select: { id: true, name: true },
    })
    if (!product) {
      return { success: false, error: `Product not found: ${ref.id}` }
    }

    const current = await context.db.conversation.findUnique({
      where: { id: context.conversationId },
      select: { candidateProductId: true, candidateAddonIds: true },
    })

    const productLabel =
      typeof product.name === 'object' && product.name !== null
        ? ((product.name as Record<string, string>)[context.language ?? 'ro'] ?? productId)
        : String(product.name)

    if (
      current?.candidateProductId === ref.id &&
      JSON.stringify(current?.candidateAddonIds ?? []) === JSON.stringify(addonIds)
    ) {
      return {
        success: true,
        data: { candidateProductId: ref.id, candidateAddonIds: addonIds, unchanged: true },
        message: `Candidate already set to ${productLabel}. No change.`,
        confirmation: {
          category: 'lifecycle',
          label: 'Candidate product set',
          value: productLabel,
          timestamp: new Date().toISOString(),
        },
      }
    }

    await context.db.conversation.update({
      where: { id: context.conversationId },
      data: {
        candidateProductId: ref.id,
        candidateAddonIds: addonIds,
        candidateSetAt: new Date(),
      },
    })

    return {
      success: true,
      data: { candidateProductId: ref.id, candidateAddonIds: addonIds },
      message: `Candidate product set to ${productLabel}${addonIds.length ? ` (addon interest: ${addonIds.join(', ')})` : ''}.`,
      confirmation: {
        category: 'lifecycle',
        label: 'Candidate product set',
        value: productLabel,
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
