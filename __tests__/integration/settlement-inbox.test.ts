import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { settlePaymentEvent, recordPaymentAnomaly } from '@/lib/payments/settlement'
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

describe('inbox anomaly alerts (D2.ADD-1, G11a)', () => {
  beforeEach(async () => { await resetDb() })

  it('amount mismatch vs the schedule row raises exactly ONE alert_flag across redeliveries', async () => {
    const fx = await buildPendingInstallmentPayment({ frequency: 'annual' })
    await prisma.payment.update({ where: { id: fx.paymentId }, data: { amountMinor: 999 } }) // drifted capture amount
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_m1', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    // redelivery under a DIFFERENT provider event id — still one alert
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_m2', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId })
    const alerts = await prisma.workItem.findMany({ where: { kind: 'ALERT_FLAG' } })
    expect(alerts).toHaveLength(1)
    expect((alerts[0].refs as { paymentId?: string }).paymentId).toBe(fx.paymentId)
    expect(alerts[0].status).toBe('OPEN')
  })

  it('unmatched events raise exactly ONE alert_flag per provider payment id', async () => {
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_u1', event: 'payment_succeeded', providerPaymentId: 'mock_pay_ghost' })
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'evt_u2', event: 'payment_succeeded', providerPaymentId: 'mock_pay_ghost' })
    expect(await prisma.workItem.count({ where: { kind: 'ALERT_FLAG' } })).toBe(1)
  })

  it('signature failures recorded through recordPaymentAnomaly are idempotent', async () => {
    await recordPaymentAnomaly({ anomaly: 'bad_signature', ref: 'PAYU:abc123', reason: 'unsigned PayU webhook rejected' })
    await recordPaymentAnomaly({ anomaly: 'bad_signature', ref: 'PAYU:abc123', reason: 'unsigned PayU webhook rejected' })
    expect(await prisma.workItem.count({ where: { kind: 'ALERT_FLAG' } })).toBe(1)
  })
})
