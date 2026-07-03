/**
 * C2.7 runtime verification of the eligibility module on the dev DB.
 *
 * Proves the LIVE seeded protect row (not just the exported constant)
 * parses under the typed schema, evaluates the age matrix
 * { 17 | 30 | 70 | undefined } × { product | addon }, and checks the
 * seeded AddonPricingRule bands against the addon_age_band rule — both
 * the envelope match AND band contiguity (erratum 4: an envelope over
 * gapped bands would declare hole-ages eligible). Prints PASS/FAIL per
 * leg; exits non-zero on failure.
 *
 * Usage: npx tsx scripts/verify-eligibility.ts
 */
import 'dotenv/config'
import { prisma } from '@/lib/db'
import { parseEligibilityRuleSet, evaluateEligibility, deriveEligibilityBounds, type EligibilityRuleSet } from '@/lib/engines/eligibility'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail && !ok ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

async function main() {
  const product = await prisma.product.findFirstOrThrow({ where: { code: 'protect' } })

  // leg 1: the live row parses (typed rules reached the DB, not just the constant)
  let rules: EligibilityRuleSet
  try {
    rules = parseEligibilityRuleSet(product.eligibility)
    check('live protect.eligibility parses under the typed schema', true)
  } catch (e) {
    check('live protect.eligibility parses under the typed schema', false, String(e))
    process.exit(1)
  }
  check('derived bounds match the ratified business content (18..64)',
    JSON.stringify(deriveEligibilityBounds(rules)) === JSON.stringify({ minAge: 18, maxAge: 64 }))

  // leg 2: the verdict matrix
  const matrix: Array<{ age: number | undefined; product: string; addon: string }> = [
    { age: 17, product: 'ineligible', addon: 'ineligible' },
    { age: 30, product: 'eligible', addon: 'unknown' },     // bd answers missing → addon unknown
    { age: 70, product: 'ineligible', addon: 'ineligible' },
    { age: undefined, product: 'unknown', addon: 'unknown' },
  ]
  for (const row of matrix) {
    const facts = { residency: 'Romania', ...(row.age !== undefined ? { age: row.age } : {}) }
    const p = evaluateEligibility(rules, facts, 'product')
    const a = evaluateEligibility(rules, facts, 'addon')
    console.log(`  age=${row.age ?? '—'}: product=${p.verdict}${p.failedRules.length ? ` [${p.failedRules.map(f => f.reason).join(',')}]` : ''} addon=${a.verdict}`)
    check(`matrix age=${row.age ?? 'undefined'}: product ${row.product}, addon ${row.addon}`,
      p.verdict === row.product && a.verdict === row.addon,
      JSON.stringify({ product: p.verdict, addon: a.verdict }))
  }

  // leg 3: pricing-band ↔ rule drift check + contiguity (erratum 4)
  const addon = await prisma.addon.findFirstOrThrow({ where: { productId: product.id, isActive: true }, include: { pricingRules: true } })
  const bands = addon.pricingRules.map((r) => ({ minAge: r.minAge, maxAge: r.maxAge })).sort((a, b) => a.minAge - b.minAge)
  let contiguous = bands.length > 0
  for (let i = 1; i < bands.length; i++) if (bands[i].minAge !== bands[i - 1].maxAge + 1) contiguous = false
  check(`seeded AddonPricingRule bands are contiguous (${bands.map(b => `${b.minAge}-${b.maxAge}`).join(', ')})`, contiguous)
  const envelope: [number, number] = [bands[0]?.minAge ?? NaN, bands[bands.length - 1]?.maxAge ?? NaN]
  const bandRule = rules.rules.find((r) => r.id === 'addon_age_band')
  check('addon_age_band rule value equals the seeded band envelope (no drift)',
    bandRule !== undefined && JSON.stringify(bandRule.value) === JSON.stringify(envelope),
    JSON.stringify({ rule: bandRule?.value, envelope }))

  console.log(failures === 0 ? '\n==== eligibility: all invariants PASS ====' : `\n==== eligibility: ${failures} FAILURE(S) ====`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
