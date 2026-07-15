/**
 * P1-6 (2026-07-15 hardening): settlement must validate the PROVIDER-REPORTED
 * captured amount + currency against what Zeno expected — not two internal
 * copies of the same expected value. A provider-side partial / wrong-amount /
 * foreign-currency capture is only detectable if the webhook's own numbers
 * reach the comparison.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '@/__tests__/helpers/test-db'
import { settlePaymentEvent } from '@/lib/payments/settlement'
import { buildPendingInstallmentPayment } from '@/__tests__/helpers/funnel-fixtures'

describe('settlement provider-reported amount/currency validation (P1-6)', () => {
  beforeEach(async () => { await resetDb() })

  async function fixtureAmount() {
    const fx = await buildPendingInstallmentPayment({ frequency: 'annual' })
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: fx.paymentId } })
    return { fx, expectedMinor: payment.amountMinor, expectedCurrency: payment.currency }
  }

  it('a valid settlement whose provider amount+currency match raises NO anomaly and applies', async () => {
    const { fx, expectedMinor, expectedCurrency } = await fixtureAmount()
    const res = await settlePaymentEvent({ provider: 'MOCK', eventId: 'ok_1', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId, providerAmountMinor: expectedMinor, providerCurrency: expectedCurrency })
    expect(res.disposition).toBe('applied')
    expect(await prisma.workItem.count({ where: { kind: 'ALERT_FLAG' } })).toBe(0)
  })

  it('a provider amount that differs from expected raises exactly ONE amount_mismatch carrying the provider value; settlement still applies', async () => {
    const { fx, expectedMinor, expectedCurrency } = await fixtureAmount()
    const res = await settlePaymentEvent({ provider: 'MOCK', eventId: 'bad_amt', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId, providerAmountMinor: expectedMinor - 500, providerCurrency: expectedCurrency })
    expect(res.disposition).toBe('applied') // money moved; operator reconciles
    const alerts = await prisma.workItem.findMany({ where: { kind: 'ALERT_FLAG' } })
    expect(alerts).toHaveLength(1)
    expect((alerts[0].payload as { anomaly?: string }).anomaly).toBe('amount_mismatch')
    expect(JSON.stringify(alerts[0].reason)).toContain(String(expectedMinor - 500)) // provider-reported captured value
  })

  it('a provider currency that differs from expected raises a currency_mismatch anomaly', async () => {
    const { fx, expectedMinor } = await fixtureAmount()
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'bad_cur', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId, providerAmountMinor: expectedMinor, providerCurrency: 'EUR' })
    const alerts = await prisma.workItem.findMany({ where: { kind: 'ALERT_FLAG' } })
    expect(alerts.some((a) => (a.payload as { anomaly?: string }).anomaly === 'currency_mismatch')).toBe(true)
  })

  it('a duplicated webhook (same event id) does not double the amount_mismatch alert', async () => {
    const { fx, expectedMinor, expectedCurrency } = await fixtureAmount()
    await settlePaymentEvent({ provider: 'MOCK', eventId: 'dup_bad', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId, providerAmountMinor: expectedMinor - 1, providerCurrency: expectedCurrency })
    const second = await settlePaymentEvent({ provider: 'MOCK', eventId: 'dup_bad', event: 'payment_succeeded', providerPaymentId: fx.providerPaymentId, providerAmountMinor: expectedMinor - 1, providerCurrency: expectedCurrency })
    expect(second.disposition).toBe('replay')
    expect(await prisma.workItem.count({ where: { kind: 'ALERT_FLAG' } })).toBe(1)
  })
})
