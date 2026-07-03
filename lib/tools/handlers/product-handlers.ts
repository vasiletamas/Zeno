/**
 * Product Handlers
 *
 * compare_products — E1.8 (T11.D5): the comparison's claims are published
 * key_value_product_points (bilingual authored content); the retired
 * features/premiumRange surfaces are gone and NO premium numbers ride a
 * pre-quote comparison — prices live in get_product_info.pricing_examples
 * and real quotes.
 */

import { prisma } from '@/lib/db'
import type { ToolHandler } from '@/lib/tools/types'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'
import { getPublishedProductContent } from '@/lib/products/product-content'

// ─────────────────────────────────────────────
// compare_products
// ─────────────────────────────────────────────

export const compareProducts: ToolHandler = async (args, context) => {
  const productIds = args.productIds as string[]

  try {
    if (!productIds || productIds.length < 2) {
      return { success: false, error: 'At least 2 product IDs are required for comparison.' }
    }

    const refs = await Promise.all(
      productIds.map((id) => resolveProductRef({ productId: id })),
    )
    const canonicalIds = refs.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.id)

    if (canonicalIds.length < 2) {
      const available = await listAvailableProductRefs()
      return {
        success: false,
        error:
          `Could not resolve enough valid products to compare. ` +
          `Available codes: ${available.map((p) => p.code).join(', ') || '(none)'}.`,
        data: { availableProducts: available as unknown as Record<string, unknown>[] },
      }
    }

    const products = await prisma.product.findMany({
      where: { id: { in: canonicalIds }, isActive: true },
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

    const comparison = await Promise.all(products.map(async p => {
      const name = p.name as { en: string; ro: string }
      const description = p.description as { en: string; ro: string }
      const published = await getPublishedProductContent(p.id)
      const points = published.fields.KEY_VALUE_PRODUCT_POINTS
      const localizedPoints = points ? ((lang === 'ro' ? points.ro : points.en) as string[] | null) : null

      return {
        id: p.id,
        code: p.code,
        name: name[lang],
        description: description[lang],
        insuranceType: p.insuranceType,
        subType: p.subType,
        key_value_product_points: localizedPoints ?? [],
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
              }
            }),
          }
        }),
        addonCount: p.addons.length,
      }
    }))

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

