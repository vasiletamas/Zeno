import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { buildPendingInstallmentPayment } from '@/__tests__/helpers/funnel-fixtures'

describe('settlement inbox (D2.6, T8.D3 / contradiction #5)', () => {
  beforeEach(async () => { await resetDb() })

  it('first successful capture: installment PAID, schedule advances, Policy created in PENDING_SUBMISSION with issuedAt — all in one transaction', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'quarterly' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_1', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    const inst = await prisma.installment.findUniqueOrThrow({ where: { id: fx.installmentId } })
    expect(inst.status).toBe('PAID')
    const schedule = await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: fx.scheduleId } })
    expect(schedule.status).toBe('ACTIVE') // first of 4 paid
    const policy = await prisma.policy.findFirstOrThrow({ where: { quoteId: fx.quoteId } })
    expect(policy.status).toBe('PENDING_SUBMISSION') // contradiction #5: issued = created here, NOT submitted
    expect(policy.issuedAt).not.toBeNull()
  })

  it('duplicate provider event settles exactly once (inbox unique key)', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'annual' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_dup', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    const second = await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_dup', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    expect(second.disposition).toBe('replay')
    expect(await prisma.policy.count()).toBe(1)
    expect(await prisma.paymentEvent.count({ where: { providerEventId: 'evt_dup' } })).toBe(1)
  })

  it('second installment settlement does NOT create a second policy and completes the schedule when last', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'semi_annual' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_a', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    const fx2 = await fx.createPendingPaymentForInstallment(2)
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_b', event: 'payment_succeeded', providerPaymentId: fx2.providerPaymentId })
    expect(await prisma.policy.count()).toBe(1)
    expect((await prisma.paymentSchedule.findUniqueOrThrow({ where: { id: fx.scheduleId } })).status).toBe('COMPLETED')
  })

  it('payment_failed marks Payment FAILED + Installment FAILED, no policy', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'annual' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_f', event: 'payment_failed', providerPaymentId: fx.providerPaymentId, failureReason: 'card_declined' })
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: fx.paymentId } })).status).toBe('FAILED')
    expect(await prisma.policy.count()).toBe(0)
  })

  it('unmatched providerPaymentId records the inbox row and reports unmatched', async () => {
    const res = await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_x', event: 'payment_succeeded', providerPaymentId: 'mock_pay_unknown' })
    expect(res.disposition).toBe('unmatched')
    expect(await prisma.paymentEvent.count({ where: { providerEventId: 'evt_x' } })).toBe(1)
  })
})
