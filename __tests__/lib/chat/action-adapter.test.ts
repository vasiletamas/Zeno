import { describe, it, expect } from 'vitest'
import { adaptAction } from '@/lib/chat/action-adapter'

describe('GUI actions are gateway-equal clients (M4)', () => {
  it('accept_quote button does NOT self-confirm — first click carries no confirm flag', () => {
    const tc = adaptAction({ type: 'accept_quote', payload: {} })
    expect(tc?.name).toBe('accept_quote')
    expect(tc?.arguments).not.toHaveProperty('confirmAcceptance')
  })
  it('confirm click round-trips the gateway-issued token', () => {
    const tc = adaptAction({ type: 'accept_quote', payload: { confirmToken: 'tok-1' } })
    expect(tc?.arguments).toEqual({ confirmToken: 'tok-1' })
  })
  it('sign_dnt passes the token through identically', () => {
    const tc = adaptAction({ type: 'sign_dnt', payload: { confirmToken: 'tok-2' } })
    expect(tc?.arguments).toEqual({ confirmToken: 'tok-2' })
  })
  it('unknown actions still return null (route 400s them)', () => {
    expect(adaptAction({ type: 'nope', payload: {} })).toBeNull()
  })
})
