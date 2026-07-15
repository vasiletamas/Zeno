import { describe, it, expect } from 'vitest'
import { getAllToolNames } from '@/lib/tools/registry'
import { ACTION_RULES } from '@/lib/engines/derive-and-expose'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('modify_quote elimination (T13.D2, D1.7)', () => {
  it('modify_quote is not registered anywhere', () => {
    // erratum 4: the registry exposes getAllToolNames(), not a toolRegistry map
    expect(getAllToolNames()).not.toContain('modify_quote')
    expect(ACTION_RULES.map((r) => r.action)).not.toContain('modify_quote')
  })

  it('the GUI change button maps to cancel_quote through the gateway (erratum 3, M4)', () => {
    expect(adaptAction({ type: 'modify_quote', payload: {} })).toBeNull()
    const call = adaptAction({ type: 'cancel_quote', payload: {} })
    expect(call).not.toBeNull()
    expect(call!.name).toBe('cancel_quote')
    expect(call!.arguments).toEqual({})
    // token round-trip: the confirm dialog re-emits with the gateway's token
    const confirmed = adaptAction({ type: 'cancel_quote', payload: { confirmToken: 'tok' } })
    expect(confirmed!.arguments).toEqual({ confirmToken: 'tok' })
  })
})
