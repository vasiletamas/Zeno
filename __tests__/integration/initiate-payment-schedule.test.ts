import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { initiatePayment } from '@/lib/tools/handlers/payment-handlers'
import { buildAcceptedQuoteWithSchedule, fixtureCtx } from '@/__tests__/helpers/funnel-fixtures'

describe('initiate_payment re-anchored to schedule (D2.8 — no Policy prerequisite)', () => {
  beforeEach(async () => { await resetDb() })

  it('creates a PENDING Payment on the first due installment with the installment amount', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'quarterly' }) // NO policy row exists
    expect(await prisma.policy.count()).toBe(0)
    const res = await initiatePayment({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success, JSON.stringify(res.error)).toBe(true)
    const payment = await prisma.payment.findFirstOrThrow({ where: { customerId: fx.customerId } })
    expect(payment.installmentId).toBe(fx.firstInstallmentId)
    expect(payment.amountMinor).toBe(fx.firstInstallmentAmountMinor) // never a premiumMonthly fallback
    expect(res.uiAction?.type).toBe('show_payment')
  })

  it('fails with no_due_installment when the schedule is fully settled', async () => {
    const fx = await buildAcceptedQuoteWithSchedule({ frequency: 'annual', settle: true })
    const res = await initiatePayment({}, fixtureCtx(fx.customerId, fx.conversationId))
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/no_due_installment/)
  })
})
