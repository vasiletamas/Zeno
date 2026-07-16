/**
 * T30: the payment_complete GUI post. Evidence (2026-07-15 live test): the
 * mock card's follow-up action 400'd at the adapter ("Unknown action type")
 * at the exact moment of paying — settlement had to be curl'd manually.
 * The action adapts to the ONLY payment read (get_payment_status) so the
 * orchestrator narrates the verified outcome + policy over the injected
 * result; settlement itself runs server-side via /api/payments/confirm.
 */
import { describe, it, expect } from 'vitest'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('payment_complete adapter case (T30)', () => {
  it('maps payment_complete to a get_payment_status read with empty args', () => {
    const call = adaptAction({ type: 'payment_complete', payload: { paymentId: 'p1' } })
    expect(call).not.toBeNull()
    expect(call!.name).toBe('get_payment_status')
    // validation.ts locks get_payment_status args to z.object({}).strict()
    expect(call!.arguments).toEqual({})
  })

  it('adapts identically without a paymentId (the read derives from conversation state)', () => {
    const call = adaptAction({ type: 'payment_complete', payload: {} })
    expect(call).not.toBeNull()
    expect(call!.name).toBe('get_payment_status')
    expect(call!.arguments).toEqual({})
  })
})
