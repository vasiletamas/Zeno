/**
 * P1-6 / security: the payment webhook endpoints (modified to thread
 * provider-reported amounts) must reject unauthenticated/unsigned calls at the
 * boundary — a forged webhook can never reach the settlement inbox.
 */
import { describe, it, expect } from 'vitest'
import { POST as stripePost } from '@/app/api/webhooks/stripe/route'

describe('payment webhook route auth (P1-6, negative)', () => {
  it('Stripe webhook without a stripe-signature header is rejected 400 (never settles)', async () => {
    const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' })
    const res = await stripePost(req)
    expect(res.status).toBe(400)
  })
})
