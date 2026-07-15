import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { buildIssuedQuote, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'
import { getQuoteInfo } from '@/lib/tools/handlers/quote-handlers'

describe('get_quote_info (D1.6)', () => {
  beforeEach(async () => { await resetDb() })

  it('returns effective status EXPIRED for a time-expired ISSUED row without writing', async () => {
    const fx = await buildIssuedQuote({ validUntil: new Date(Date.now() - 1000) })
    const res = await getQuoteInfo({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success).toBe(true)
    expect((res.data as { status: string }).status).toBe('EXPIRED')
    // pure read (T7.D5): the ROW still says ISSUED — opportunistic
    // persistence happens only on commit attempts, at the gateway
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: fx.quoteId } })).status).toBe('ISSUED')
  })

  it('bundles payment_options from Product.paymentFrequencyOptions ∩ quote premium variants (no monthly)', async () => {
    const fx = await buildIssuedQuote()
    const res = await getQuoteInfo({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success).toBe(true)
    const options = (res.data as { payment_options: { option: string; amount: number; currency: string }[] }).payment_options
    expect(options.map((o) => o.option).sort()).toEqual(['annual', 'quarterly', 'semi_annual'])
    expect(options.find((o) => o.option === 'annual')!.amount).toBeGreaterThan(0)
    expect(options.every((o) => o.currency === 'RON')).toBe(true)
  })
})
