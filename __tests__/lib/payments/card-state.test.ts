/**
 * P1-5 (2026-07-15 hardening): the payment card must NEVER mount Stripe
 * <Elements> (or a PayU redirect) with a null credential. resolvePaymentCardState
 * is the pure decision the component renders from — a missing credential yields
 * an explicit 'unavailable' state, not a broken mount.
 */
import { describe, it, expect } from 'vitest'
import { resolvePaymentCardState } from '@/lib/payments/card-state'

describe('resolvePaymentCardState (P1-5)', () => {
  it('answered wins over everything', () => {
    expect(resolvePaymentCardState({ isAnswered: true, providerName: 'stripe', clientSecret: null, redirectUrl: null }))
      .toEqual({ kind: 'answered' })
  })

  it('stripe with a client secret → mountable form', () => {
    expect(resolvePaymentCardState({ isAnswered: false, providerName: 'stripe', clientSecret: 'pi_secret_123', redirectUrl: null }))
      .toEqual({ kind: 'stripe_form', clientSecret: 'pi_secret_123' })
  })

  it('stripe with a NULL client secret → unavailable (never mount Elements with null)', () => {
    expect(resolvePaymentCardState({ isAnswered: false, providerName: 'stripe', clientSecret: null, redirectUrl: null }))
      .toEqual({ kind: 'unavailable' })
  })

  it('payu with a redirect url → redirect', () => {
    expect(resolvePaymentCardState({ isAnswered: false, providerName: 'payu', clientSecret: null, redirectUrl: 'https://payu/pay/x' }))
      .toEqual({ kind: 'payu_redirect', redirectUrl: 'https://payu/pay/x' })
  })

  it('payu with a NULL redirect → unavailable (never leave a dead disabled button)', () => {
    expect(resolvePaymentCardState({ isAnswered: false, providerName: 'payu', clientSecret: null, redirectUrl: null }))
      .toEqual({ kind: 'unavailable' })
  })

  it('mock never needs a secret', () => {
    expect(resolvePaymentCardState({ isAnswered: false, providerName: 'mock', clientSecret: null, redirectUrl: null }))
      .toEqual({ kind: 'mock_form' })
  })
})
