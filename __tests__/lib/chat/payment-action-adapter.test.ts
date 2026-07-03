import { describe, it, expect } from 'vitest'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('payment GUI actions go through the same commit as the agent (D3.5, M4 swap test)', () => {
  it('pay_now maps to ensure_payment_session with no mode input (mode is engine output)', () => {
    const call = adaptAction({ type: 'pay_now', payload: {} })
    expect(call).toMatchObject({ name: 'ensure_payment_session', arguments: {} })
  })
  it('no GUI action maps to initiate_payment any more (erratum 2: unknown types are null)', () => {
    expect(adaptAction({ type: 'initiate_payment', payload: {} })).toBeNull()
  })
})
