import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { PayUPaymentProvider } from '@/lib/payments/providers/payu'
import { mapStripeEvent } from '@/lib/payments/providers/stripe'
import { MockPaymentProvider } from '@/lib/payments/providers/mock'

describe('PayU webhook signature (D2.7 security hardening)', () => {
  const provider = new PayUPaymentProvider()
  const payload = JSON.stringify({ order: { orderId: 'o1', status: 'COMPLETED' } })
  let savedEnv: { merchant?: string; secret?: string }

  // erratum 4: env for the WHOLE block — the unsigned-rejection test must
  // reach the signature check, not die on the config read
  beforeAll(() => {
    savedEnv = { merchant: process.env.PAYU_MERCHANT_ID, secret: process.env.PAYU_SECRET_KEY }
    process.env.PAYU_MERCHANT_ID = 'm'
    process.env.PAYU_SECRET_KEY = 'sk'
  })
  afterAll(() => {
    if (savedEnv.merchant === undefined) delete process.env.PAYU_MERCHANT_ID
    else process.env.PAYU_MERCHANT_ID = savedEnv.merchant
    if (savedEnv.secret === undefined) delete process.env.PAYU_SECRET_KEY
    else process.env.PAYU_SECRET_KEY = savedEnv.secret
  })

  it('REJECTS payloads whose signature header lacks a signature= segment (closes the bypass)', async () => {
    await expect(provider.handleWebhook(payload, 'algorithm=MD5;sender=checkout')).rejects.toThrow(/signature/i)
  })

  it('rejects wrong signatures, accepts correct HMAC-MD5, and derives eventId orderId:status', async () => {
    const good = crypto.createHmac('md5', 'sk').update(payload).digest('hex')
    await expect(provider.handleWebhook(payload, 'signature=deadbeef;algorithm=MD5')).rejects.toThrow()
    const evt = await provider.handleWebhook(payload, `signature=${good};algorithm=MD5`)
    expect(evt).toMatchObject({ event: 'payment_succeeded', providerPaymentId: 'o1', eventId: 'o1:COMPLETED' })
  })
})

describe('Stripe event mapping (D2.7)', () => {
  it('unknown event types map to the explicit ignored variant with the stripe event id', () => {
    expect(mapStripeEvent({ id: 'evt_x', type: 'customer.created', data: { object: {} } } as never))
      .toMatchObject({ event: 'ignored', eventId: 'evt_x', providerPaymentId: '' })
  })
  it('payment_intent.succeeded carries the stripe event id', () => {
    expect(mapStripeEvent({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1', metadata: {} } } } as never))
      .toMatchObject({ event: 'payment_succeeded', eventId: 'evt_1', providerPaymentId: 'pi_1' })
  })
})

describe('Mock provider ids (D2.7, erratum 9)', () => {
  it('two intents in the same millisecond do not collide under the @unique constraint', async () => {
    const mock = new MockPaymentProvider()
    const input = { amount: 100, currency: 'RON', customerId: 'c', referenceId: 's', description: 'd' }
    const [a, b] = await Promise.all([mock.createPaymentIntent(input), mock.createPaymentIntent(input)])
    expect(a.providerPaymentId).not.toBe(b.providerPaymentId)
  })
  it('webhook eventId derives from providerPaymentId', async () => {
    const mock = new MockPaymentProvider()
    const evt = await mock.handleWebhook(JSON.stringify({ providerPaymentId: 'mock_pay_1' }), '')
    expect(evt.eventId).toBe('mock_mock_pay_1')
  })
})
