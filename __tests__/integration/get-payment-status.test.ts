import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { getPaymentStatus } from '@/lib/tools/handlers/payment-handlers'
import { buildAcceptedQuoteWithSchedule, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

describe('get_payment_status (D3.2, contradiction #3)', () => {
  beforeEach(async () => { await resetDb() })

  it('answers from schedule state only — amounts are installment amountMinor, even when Quote floats disagree', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly' })
    // poison the quote display figure to prove the read never touches it
    await prisma.quote.update({ where: { id: fx.quoteId }, data: { premiumQuarterly: 999999 } })
    const res = await getPaymentStatus({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success).toBe(true)
    const d = res.data as { frequency: string; installments: { sequence: number; amountMinor: number; status: string }[]; nextDue: { sequence: number; amountMinor: number } }
    expect(d.frequency).toBe('quarterly')
    expect(d.installments).toHaveLength(4)
    expect(d.nextDue.amountMinor).toBe(fx.firstInstallmentAmountMinor)
    expect(d.installments.every((i) => i.amountMinor < 999999 * 100)).toBe(true)
  })

  it('reports no schedule as a precise error', async () => {
    const { seedMinimalProtectFixture } = await import('@/__tests__/helpers/test-db')
    const fx = await seedMinimalProtectFixture({ tier: 'standard', level: 'level_1', addon: false })
    const res = await getPaymentStatus({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/payment_not_pending/)
  })
})
