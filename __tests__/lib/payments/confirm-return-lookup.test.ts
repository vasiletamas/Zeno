/**
 * T30: the GET /api/payments/confirm return lookup. Evidence (2026-07-15):
 * the Stripe card's return_url passes ?provider=stripe&paymentId=... but the
 * GET handler read ONLY orderId — every 3DS redirect return 400'd
 * "Missing orderId parameter".
 */
import { describe, it, expect } from 'vitest'
import { resolveReturnLookup } from '@/lib/payments/confirm-return-lookup'

describe('resolveReturnLookup (T30)', () => {
  it('resolves orderId to a providerPaymentId lookup (PayU return)', () => {
    const lookup = resolveReturnLookup(new URLSearchParams('provider=payu&orderId=payu_9'))
    expect(lookup).toEqual({ by: 'orderId', providerPaymentId: 'payu_9' })
  })

  it('resolves paymentId to a Payment-row-id lookup (Stripe 3DS return)', () => {
    const lookup = resolveReturnLookup(new URLSearchParams('provider=stripe&paymentId=pay_1'))
    expect(lookup).toEqual({ by: 'paymentId', paymentId: 'pay_1' })
  })

  it('prefers orderId when both are present (PayU behavior stays byte-identical)', () => {
    const lookup = resolveReturnLookup(new URLSearchParams('orderId=payu_9&paymentId=pay_1'))
    expect(lookup).toEqual({ by: 'orderId', providerPaymentId: 'payu_9' })
  })

  it('resolves to none when neither is present or both are empty', () => {
    expect(resolveReturnLookup(new URLSearchParams('provider=stripe'))).toEqual({ by: 'none' })
    expect(resolveReturnLookup(new URLSearchParams('orderId=&paymentId='))).toEqual({ by: 'none' })
  })
})
