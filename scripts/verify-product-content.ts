/**
 * E1.9 runtime consistency check (dev DB): the product-data package's four
 * invariants, verified against LIVE rows —
 *  (1) every pricing_examples cell equals a direct calculateQuote recompute;
 *  (2) published ProductContent is locale-complete and numeral-free
 *      (placeholders excluded);
 *  (3) the get_product_info payload carries the derived surfaces
 *      (pricing_examples / eligibility_bounds / key_value_product_points)
 *      and none of the retired authored ones;
 *  (4) contentVersions ids ride the envelope (M8 stamp source).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/verify-product-content.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { calculateQuote } from '@/lib/engines/quote-engine'
import { derivePricingExamples, type PricingExampleGrid } from '@/lib/engines/pricing-examples'
import { getToolHandler } from '@/lib/tools/registry'
import type { ToolContext } from '@/lib/tools/types'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS — ${name}`)
  } else {
    failures += 1
    console.error(`FAIL — ${name}`, detail === undefined ? '' : JSON.stringify(detail, null, 2))
  }
}

async function main() {
  const product = await prisma.product.findUniqueOrThrow({
    where: { code: 'protect' },
    include: {
      pricingTiers: { where: { isActive: true }, include: { levels: { where: { isActive: true } } } },
      addons: { where: { isActive: true }, include: { pricingRules: true } },
    },
  })

  // ── (1) derived examples === direct calculateQuote recompute ─────────
  const grid = product.pricingExampleGrid as unknown as PricingExampleGrid | null
  if (!grid) throw new Error('protect has no pricingExampleGrid — E1.8 seed missing')
  const tree = {
    quoteValidityDays: product.quoteValidityDays,
    tiers: product.pricingTiers.map((t) => ({
      code: t.code,
      name: t.name as { en: string; ro: string },
      levels: t.levels.map((l) => ({ code: l.code, name: l.name as { en: string; ro: string }, premiumAnnual: l.premiumAnnual })),
    })),
    addonRules: (product.addons[0]?.pricingRules ?? []).map((r) => ({ minAge: r.minAge, maxAge: r.maxAge, premiumAnnual: r.premiumAnnual })),
  }
  const examples = derivePricingExamples(tree, grid)
  const expectedCells = grid.samplePoints.length * grid.tiers.length * grid.levels.length
  check(`grid derives ${expectedCells} cells`, examples.length === expectedCells, { got: examples.length })

  let mismatches = 0
  for (const cell of examples) {
    const tier = tree.tiers.find((t) => t.code === cell.tier)!
    const level = tier.levels.find((l) => l.code === cell.level)!
    const base = calculateQuote({
      tierCode: cell.tier, levelCode: cell.level, customerAge: cell.age, includesAddon: false,
      paymentFrequency: 'annual',
      pricingLevel: { premiumAnnual: level.premiumAnnual, name: level.name },
      pricingTier: { name: tier.name },
      baseCoverages: [], addonPricingRule: null, addonCoverages: [],
      quoteValidityDays: tree.quoteValidityDays,
    })
    if (cell.base.premiumAnnual !== base.premiumAnnual || cell.base.premiumMonthly !== base.premiumMonthly) {
      mismatches += 1
      console.error('  cell/base mismatch', cell, { expected: base.premiumAnnual })
    }
    const rule = tree.addonRules.find((r) => cell.age >= r.minAge && cell.age <= r.maxAge)
    if (rule) {
      const withAddon = calculateQuote({
        tierCode: cell.tier, levelCode: cell.level, customerAge: cell.age, includesAddon: true,
        paymentFrequency: 'annual',
        pricingLevel: { premiumAnnual: level.premiumAnnual, name: level.name },
        pricingTier: { name: tier.name },
        baseCoverages: [], addonPricingRule: { premiumAnnual: rule.premiumAnnual }, addonCoverages: [],
        quoteValidityDays: tree.quoteValidityDays,
      })
      const w = cell.withAddon
      if (!w || !('premiumAnnual' in w) || w.premiumAnnual !== withAddon.premiumAnnual) {
        mismatches += 1
        console.error('  cell/withAddon mismatch', cell, { expected: withAddon.premiumAnnual })
      }
    } else if (!cell.withAddon || !('ineligible' in cell.withAddon)) {
      mismatches += 1
      console.error('  cell should be addon-ineligible', cell)
    }
  }
  check('every cell equals a direct calculateQuote recompute (base AND base+addon)', mismatches === 0, { mismatches })

  // ── (2) published content: locale-complete + numeral-free ────────────
  const published = await prisma.productContent.findMany({ where: { status: 'PUBLISHED' } })
  check('published content exists', published.length >= 8, { count: published.length })
  const groups = new Map<string, Set<string>>()
  for (const row of published) {
    const key = `${row.productId}::${row.addonId ?? ''}::${row.field}::${row.version}`
    if (!groups.has(key)) groups.set(key, new Set())
    groups.get(key)!.add(row.locale)
  }
  const incomplete = [...groups.entries()].filter(([, locales]) => !locales.has('ro') || !locales.has('en'))
  check('every published (field, addon, version) group carries ro AND en', incomplete.length === 0, incomplete.map(([k]) => k))
  const numeralRows = published.filter((r) => /\d/.test(JSON.stringify(r.content).replace(/\{\{[^}]+\}\}/g, '')))
  check('no published row carries raw numerals (placeholders excluded)', numeralRows.length === 0, numeralRows.map((r) => `${r.field}:${r.locale}`))

  // ── (3)+(4) live get_product_info payload ─────────────────────────────
  const customer = await prisma.customer.create({ data: { isAnonymous: true, language: 'ro' } })
  const conversation = await prisma.conversation.create({ data: { customerId: customer.id } })
  const ctx = { customerId: customer.id, conversationId: conversation.id, language: 'ro', db: prisma } as unknown as ToolContext
  const handler = getToolHandler('get_product_info')
  if (!handler) throw new Error('get_product_info not registered')
  const result = await handler({ productCode: 'protect' }, ctx)
  if (!result.success) throw new Error(`get_product_info failed: ${result.error}`)
  const payload = result.data as { product: Record<string, unknown>; contentVersions: string[] }
  const shaped = payload.product

  check('payload carries non-empty pricing_examples', Array.isArray(shaped.pricing_examples) && (shaped.pricing_examples as unknown[]).length === expectedCells)
  check('payload carries eligibility_bounds 18..64', JSON.stringify((shaped.eligibility_bounds as Record<string, unknown>)?.minAge) === '18' && JSON.stringify((shaped.eligibility_bounds as Record<string, unknown>)?.maxAge) === '64')
  const points = shaped.key_value_product_points as { ro?: string[] } | null
  check('payload carries published key_value_product_points (ro)', !!points?.ro && points.ro.length >= 8)
  const addons = shaped.addons as { code: string; sell_specific_addon_info: unknown }[]
  const bd = addons.find((a) => a.code === 'TREATMENT_ABROAD_BD')
  check('addons[] fold sell_specific_addon_info with RESOLVED placeholders', !!bd && typeof (bd.sell_specific_addon_info as { ro?: string })?.ro === 'string' && (bd.sell_specific_addon_info as { ro: string }).ro.includes('2.000.000') && !(bd.sell_specific_addon_info as { ro: string }).ro.includes('{{'))
  for (const legacy of ['pricingExplanation', 'features', 'premiumRange', 'targetAgeRange', 'eligibility']) {
    check(`payload lacks retired surface ${legacy}`, !(legacy in shaped))
  }
  check('contentVersions ids present (M8 stamp source)', Array.isArray(payload.contentVersions) && payload.contentVersions.length >= 8, payload.contentVersions)

  if (failures > 0) {
    console.error(`\n==== product content: ${failures} FAILURE(S) ====`)
    process.exit(1)
  }
  console.log('\n==== product content: all invariants PASS ====')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
