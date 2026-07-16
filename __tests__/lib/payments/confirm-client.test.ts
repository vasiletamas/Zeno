/**
 * T30: the GUI settlement client. Evidence (2026-07-15 live test): the mock
 * card faked a 2s delay and never POSTed /api/payments/confirm — the
 * provider-verified settlement inbox (which mints the Policy in-transaction)
 * only ran because someone curl'd it manually 4m47s after the last message.
 */
import { describe, it, expect, vi } from 'vitest'
import { confirmMockPayment } from '@/lib/payments/confirm-client'

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('confirmMockPayment (T30)', () => {
  it('POSTs /api/payments/confirm with the paymentId and returns the parsed settlement', async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(200, { success: true, policyStatus: 'ACTIVE' }),
    )

    const result = await confirmMockPayment('pay_1', fetchStub as unknown as typeof fetch)

    expect(fetchStub).toHaveBeenCalledWith('/api/payments/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: 'pay_1' }),
    })
    expect(result).toEqual({ success: true, policyStatus: 'ACTIVE' })
  })

  it('throws a legible error on a non-ok response (provider-verified failure)', async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(400, { error: 'Payment failed', failureReason: 'card_declined' }),
    )

    await expect(
      confirmMockPayment('pay_1', fetchStub as unknown as typeof fetch),
    ).rejects.toThrow(/Payment failed/)
  })

  it('throws a legible error on 200 success:false (still processing) — no retry loop', async () => {
    const fetchStub = vi.fn(async () =>
      jsonResponse(200, { success: false, message: 'Payment still processing' }),
    )

    await expect(
      confirmMockPayment('pay_1', fetchStub as unknown as typeof fetch),
    ).rejects.toThrow(/still processing/i)
    // one shot only — the mock provider always completes server-side
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})
