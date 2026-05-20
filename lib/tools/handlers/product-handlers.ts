/**
 * Product Handlers
 *
 * compare_products, set_conversation_product
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'

// ─────────────────────────────────────────────
// compare_products
// ─────────────────────────────────────────────

export const compareProducts: ToolHandler = async (args, context) => {
  const productIds = args.productIds as string[]

  try {
    if (!productIds || productIds.length < 2) {
      return { success: false, error: 'At least 2 product IDs are required for comparison.' }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: {
        pricingTiers: {
          where: { isActive: true },
          include: {
            levels: {
              where: { isActive: true },
              orderBy: { orderIndex: 'asc' },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
        addons: {
          where: { isActive: true },
        },
      },
    })

    if (products.length < 2) {
      return { success: false, error: 'Could not find enough valid products to compare.' }
    }

    const lang = context.language ?? 'ro'

    const comparison = products.map(p => {
      const name = p.name as { en: string; ro: string }
      const description = p.description as { en: string; ro: string }
      const premiumRange = p.premiumRange as Record<string, unknown> | null

      return {
        id: p.id,
        code: p.code,
        name: name[lang],
        description: description[lang],
        insuranceType: p.insuranceType,
        subType: p.subType,
        features: p.features,
        premiumRange,
        targetCustomer: p.targetCustomer,
        contractTerm: p.contractTerm,
        tiers: p.pricingTiers.map(t => {
          const tierName = t.name as { en: string; ro: string }
          return {
            code: t.code,
            name: tierName[lang],
            levels: t.levels.map(l => {
              const levelName = l.name as { en: string; ro: string }
              return {
                code: l.code,
                name: levelName[lang],
                premiumAnnual: l.premiumAnnual,
                currency: l.currency,
              }
            }),
          }
        }),
        addonCount: p.addons.length,
      }
    })

    const names = comparison.map(c => c.name).join(' vs ')

    return {
      success: true,
      data: { comparison: comparison as unknown as Record<string, unknown>[] },
      message: `Comparing ${names}.`,
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ─────────────────────────────────────────────
// set_conversation_product
// ─────────────────────────────────────────────

export const setConversationProduct: ToolHandler = async (args, context) => {
  const productId = args.productId as string

  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product || !product.isActive) {
      return { success: false, error: 'Product not found or not available.' }
    }

    await prisma.conversation.update({
      where: { id: context.conversationId },
      data: { productId: product.id },
    })

    const name = product.name as { en: string; ro: string }
    const lang = context.language ?? 'ro'

    return {
      success: true,
      data: {
        productSet: true,
        productId: product.id,
        productCode: product.code,
        productName: name[lang],
        insuranceType: product.insuranceType,
      },
      message: `Product set to ${name[lang]}.`,
      confirmation: {
        category: 'lifecycle',
        label: lang === 'en' ? 'Selected product' : 'Produs selectat',
        value: `${product.code} — ${name[lang]}`,
        timestamp: new Date().toISOString(),
      },
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
