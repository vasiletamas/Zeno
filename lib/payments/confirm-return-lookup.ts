/**
 * T30: the GET /api/payments/confirm return lookup. Two return shapes exist:
 * PayU's hosted page sends ?orderId=<providerPaymentId>; the Stripe card's
 * 3DS return_url sends ?paymentId=<Payment row id>. The handler reading only
 * orderId 400'd every Stripe redirect return. orderId wins when both are
 * present so the PayU path stays byte-identical.
 */

export type ReturnLookup =
  | { by: 'orderId'; providerPaymentId: string }
  | { by: 'paymentId'; paymentId: string }
  | { by: 'none' }

export function resolveReturnLookup(searchParams: URLSearchParams): ReturnLookup {
  const orderId = searchParams.get('orderId')
  if (orderId) return { by: 'orderId', providerPaymentId: orderId }

  const paymentId = searchParams.get('paymentId')
  if (paymentId) return { by: 'paymentId', paymentId }

  return { by: 'none' }
}
