/**
 * T18 (P4.2): a mixed-denomination rate card (EUR addon tariff vs RON level)
 * makes generate_quote obtain the FX reference, convert the addon component,
 * and FREEZE the rate+date+source into Quote.ratingInputs.fx — the priced
 * artifact carries its own conversion evidence.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { executeCommit } from '@/lib/tools/gateway'
import { buildReadyApplication, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

const gq = (fx: { customerId: string; conversationId: string }) =>
  executeCommit({ tool: 'generate_quote', args: {}, actor: 'agent', customerId: fx.customerId, conversationId: fx.conversationId, toolContext: fixtureCtx(fx.customerId, fx.conversationId) })

describe('T18: FX reference frozen into the rating snapshot', () => {
  beforeEach(async () => { await resetDb() }, 60000)

  it('EUR addon rules: premium reflects the conversion and ratingInputs.fx records rate+date+source', async () => {
    const fx = await buildReadyApplication({ addon: true })
    // the addon rate card in its true denomination (idempotent under the
    // T17 seed, which flips the rows to EUR permanently)
    await prisma.addonPricingRule.updateMany({ data: { currency: 'EUR' } })

    const res = await gq(fx)
    expect(res.outcome).toBe('applied')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
    // DOB 1990-01-01 → band 31-45 → 350 EUR * 5.06 (default fixed rate) = 1771
    expect(quote.premiumAnnual).toBe(1961) // 190 + 1771
    const ri = quote.ratingInputs as Record<string, unknown>
    expect(ri.addonPremiumAnnual).toBe(1771)
    expect(ri.basePremiumAnnual).toBe(190)
    expect(ri.fx).toEqual({ rate: 5.06, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), source: 'fixed:env' })
  }, 120000)

  it('same-currency rate card records NO fx — the placeholder stays null', async () => {
    const fx = await buildReadyApplication({ addon: true })
    // pin BOTH sides to the same denomination regardless of the seeded card
    await prisma.addonPricingRule.updateMany({ data: { currency: 'RON' } })
    const res = await gq(fx)
    expect(res.outcome).toBe('applied')
    const quote = await prisma.quote.findUniqueOrThrow({ where: { applicationId: fx.applicationId } })
    const ri = quote.ratingInputs as Record<string, unknown>
    expect(ri.fx).toBeNull()
    expect(quote.premiumAnnual).toBe(540) // 190 + 350, unconverted
  }, 120000)
})
