/**
 * P1-5: the pure decision the PaymentCard renders from. A missing provider
 * credential yields an explicit 'unavailable' state — the component must never
 * mount Stripe <Elements> with a null clientSecret, nor leave a permanently
 * disabled PayU button. Backend stays authoritative (it decides mode + supplies
 * credentials); this only maps what arrived to what is safe to render.
 */
export type PaymentCardState =
  | { kind: 'answered' }
  | { kind: 'stripe_form'; clientSecret: string }
  | { kind: 'payu_redirect'; redirectUrl: string }
  | { kind: 'mock_form' }
  | { kind: 'unavailable' }

export function resolvePaymentCardState(input: {
  isAnswered: boolean
  providerName: string
  clientSecret: string | null
  redirectUrl: string | null
}): PaymentCardState {
  if (input.isAnswered) return { kind: 'answered' }
  if (input.providerName === 'stripe') {
    return input.clientSecret ? { kind: 'stripe_form', clientSecret: input.clientSecret } : { kind: 'unavailable' }
  }
  if (input.providerName === 'payu') {
    return input.redirectUrl ? { kind: 'payu_redirect', redirectUrl: input.redirectUrl } : { kind: 'unavailable' }
  }
  // mock completes in-card with no external credential
  return { kind: 'mock_form' }
}
