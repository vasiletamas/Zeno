/**
 * T30: the GUI settlement client. The payment card must never report success
 * on its own say-so — POST /api/payments/confirm runs the provider-verified
 * settlement inbox (which mints the Policy in-transaction) and only a
 * verified `success:true` reaches onPaymentComplete. Idempotent server-side
 * (derived eventId), so a Stripe-webhook double-settlement replays harmlessly.
 */

interface ConfirmResponseBody {
  success?: boolean
  policyStatus?: string
  message?: string
  error?: string
}

export async function confirmMockPayment(
  paymentId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: true; policyStatus: string }> {
  const res = await fetchImpl('/api/payments/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId }),
  })

  const body = (await res.json().catch(() => ({}))) as ConfirmResponseBody

  if (!res.ok) {
    throw new Error(
      `Payment confirmation failed (${res.status}): ${body.error ?? 'unknown error'}`,
    )
  }
  if (!body.success) {
    // 200 success:false = provider still processing — one legible failure,
    // never a client retry loop (the mock provider always completes)
    throw new Error(body.message ?? 'Payment still processing at the provider')
  }

  return { success: true, policyStatus: body.policyStatus ?? 'PENDING_SUBMISSION' }
}
